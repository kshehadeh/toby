import Foundation
import GRDB
import TobyAI

/// `followups` settings from config.json (defaults match the daemon).
public struct FollowupConfig: Sendable {
	public var enabled = true
	public var intervalMinutes = 30
	public var sources: [String: Bool] = [:]
	public var kinds: [String: Bool] = [:]
	public var openThreshold = 0.75
	public var closeThreshold = 0.85
	public var autoComplete = true
	public var awaitingReplyDays = 3.0
	public var maxEvaluationsPerDay = 200
	public var notifications = true

	public init(_ raw: JSONValue? = nil) {
		guard let raw else { return }
		enabled = raw["enabled"] != false
		if let interval = raw["intervalMinutes"]?.doubleValue, interval >= 1 { intervalMinutes = Int(interval.rounded()) }
		sources = (raw["sources"]?.objectValue ?? [:]).compactMapValues(\.boolValue)
		kinds = (raw["kinds"]?.objectValue ?? [:]).compactMapValues(\.boolValue)
		openThreshold = raw["thresholds"]?["open"]?.doubleValue ?? openThreshold
		closeThreshold = raw["thresholds"]?["close"]?.doubleValue ?? closeThreshold
		autoComplete = raw["autoComplete"] != false
		if let days = raw["awaitingReplyDays"]?.doubleValue { awaitingReplyDays = max(0, min(30, days)) }
		if let budget = raw["maxEvaluationsPerDay"]?.doubleValue { maxEvaluationsPerDay = Int(budget) }
		notifications = raw["notifications"] != false
	}

	var settingsJSON: JSONValue {
		["awaitingReplyDays": .number(awaitingReplyDays), "sources": .object(sources.mapValues(JSONValue.bool)), "kinds": .object(kinds.mapValues(JSONValue.bool)),
		 "thresholds": ["open": .number(openThreshold), "close": .number(closeThreshold)], "autoComplete": .bool(autoComplete), "evaluator": .null]
	}
}

public struct FollowupLoop: Sendable, Equatable {
	public var loopID: String
	public var kind: String
	public var status: String
	public var fingerprint: String
	public var title: String
	public var counterpart: String?
	public var dueAt: String?
	public var confidence: Double
	public var todoID: String?
	public var resolutionRejected: Bool
	public var reopenedAt: String?
	public var lastActivityAt: String
	public var lastEvaluatedHash: String?
	public var createdAt: String
	public var updatedAt: String

	/// The daemon's loop JSON (camelCase, optional fields omitted).
	public var json: JSONValue {
		var out: [String: JSONValue] = [
			"loopId": .string(loopID), "kind": .string(kind), "status": .string(status), "fingerprint": .string(fingerprint), "title": .string(title),
			"confidence": .number(confidence), "resolutionRejected": .bool(resolutionRejected), "lastActivityAt": .string(lastActivityAt),
			"createdAt": .string(createdAt), "updatedAt": .string(updatedAt),
		]
		if let counterpart { out["counterpart"] = .string(counterpart) }
		if let dueAt { out["dueAt"] = .string(dueAt) }
		if let todoID { out["todoId"] = .string(todoID) }
		if let reopenedAt { out["reopenedAt"] = .string(reopenedAt) }
		if let lastEvaluatedHash { out["lastEvaluatedHash"] = .string(lastEvaluatedHash) }
		return .object(out)
	}

	init(_ row: Row) {
		loopID = row["loop_id"]
		kind = row["kind"]
		status = row["status"]
		fingerprint = row["fingerprint"]
		title = row["title"]
		counterpart = row["counterpart"]
		dueAt = row["due_at"]
		confidence = row["confidence"]
		todoID = row["todo_id"]
		resolutionRejected = (row["resolution_rejected"] as Int?) == 1
		reopenedAt = row["reopened_at"]
		lastActivityAt = row["last_activity_at"]
		lastEvaluatedHash = row["last_evaluated_hash"]
		createdAt = row["created_at"]
		updatedAt = row["updated_at"]
	}
}

/// Open loops (owe a reply, awaiting a reply, commitments) found in observed
/// activity, tracked as "From Toby" todos (port of `followups/*`).
public actor FollowupService {
	struct Unit: Sendable {
		var id: String
		var hash: String
		var nodeIDs: [String]
		var loopIDs: [String]
		var waitingReplyEligible: Bool
		var promptContext: String
		var sourceText: String
		var evaluatedAt: String
	}

	public struct Stats: Sendable, Equatable {
		public var status = "ok"
		public var ingested = 0
		public var enriched = 0
		public var reconciled = 0
		public var candidates = 0
		public var evaluated = 0
		public var opened = 0
		public var closed = 0
		public var error: String?
	}

	public typealias Evaluate = @Sendable (_ prompt: String, _ system: String) async throws -> JSONValue

	static let expireDays = 30.0
	static let batchSize = 8
	static let maxChanged = 2000
	static let loopColumns = "loop_id, kind, status, fingerprint, title, counterpart, due_at, confidence, todo_id, resolution_rejected, reopened_at, last_evaluated_hash, last_activity_at, created_at, updated_at"

	let writer: any DatabaseWriter
	let todos: TodoService
	let sources: [any ObservationSource]
	let config: @Sendable () -> FollowupConfig
	let embedder: @Sendable () -> (any TextEmbedder)?
	let evaluate: Evaluate?
	let extract: GraphEnrichment.Extract?
	let ready: @Sendable () -> Bool
	let notify: @Sendable ([String]) async -> Void
	var running: Task<Stats, Never>?

	public init(
		writer: any DatabaseWriter, todos: TodoService, sources: [any ObservationSource], config: @escaping @Sendable () -> FollowupConfig = { FollowupConfig() },
		embedder: @escaping @Sendable () -> (any TextEmbedder)? = { nil }, evaluate: Evaluate?, extract: GraphEnrichment.Extract?,
		notify: @escaping @Sendable ([String]) async -> Void = { _ in },
		ready: @escaping @Sendable () -> Bool = { true },
	) {
		self.ready = ready
		self.writer = writer
		self.todos = todos
		self.sources = sources
		self.config = config
		self.embedder = embedder
		self.evaluate = evaluate
		self.extract = extract
		self.notify = notify
	}

	/// The OpenRouter evaluator (structured model).
	public static func modelEvaluator(_ model: LanguageModel) -> Evaluate {
		{ prompt, system in
			try await generateJSON(ObjectRequest(model: model, instructions: system, messages: [.user(prompt)], schema: evaluationSchema,
			                                     schemaName: "TobyFollowupEvaluation", schemaDescription: "Follow-up opening and closing decisions tied to evidence IDs", maxOutputTokens: 2500)).object
		}
	}

	static let evaluationSchema: JSONSchema = .object([
		"units": .array(.object([
			"unitId": .string(),
			"open": .array(.object([
				"kind": .string(enum: ["owe_reply", "awaiting_reply", "commitment"]), "title": .string(), "counterpart": .string(),
				"due": .string(description: "ISO 8601 with offset, or empty"), "confidence": .number(), "evidenceIds": .array(.string()),
			])),
			"close": .array(.object(["loopId": .string(), "confidence": .number(), "evidenceId": .string(), "reason": .string()])),
		])),
	])

	static func sha(_ text: String) -> String { FeedText.sha(text) }
	public static func todoID(fingerprint: String) -> String { "toby-followup-\(sha(fingerprint).prefix(40))" }
	static func normalized(_ title: String) -> String { MemoryText.collapseWhitespace(title.lowercased()) }

	// MARK: Store

	static func loop(_ db: Database, _ id: String) throws -> FollowupLoop? {
		try Row.fetchOne(db, sql: "SELECT \(loopColumns) FROM followup_loops WHERE loop_id = ?", arguments: [id]).map(FollowupLoop.init)
	}

	static func loops(_ db: Database, status: String? = nil) throws -> [FollowupLoop] {
		try Row.fetchAll(db, sql: "SELECT \(loopColumns) FROM followup_loops \(status == nil ? "" : "WHERE status = ?") ORDER BY updated_at DESC LIMIT 1000",
		                 arguments: StatementArguments(status.map { [$0] } ?? [])).map(FollowupLoop.init)
	}

	static func byFingerprint(_ db: Database, _ fingerprint: String) throws -> FollowupLoop? {
		try Row.fetchOne(db, sql: "SELECT \(loopColumns) FROM followup_loops WHERE fingerprint = ?", arguments: [fingerprint]).map(FollowupLoop.init)
	}

	static func update(_ db: Database, _ id: String, status: String? = nil, resolutionRejected: Bool? = nil, reopenedAt: String? = nil, lastActivityAt: String? = nil, todoID: String? = nil, at: String) throws {
		var sets = ["updated_at = ?"]
		var args: [any DatabaseValueConvertible] = [at]
		if let status { sets.append("status = ?"); args.append(status) }
		if let resolutionRejected { sets.append("resolution_rejected = ?"); args.append(resolutionRejected ? 1 : 0) }
		if let reopenedAt { sets.append("reopened_at = ?"); args.append(reopenedAt) }
		if let lastActivityAt { sets.append("last_activity_at = ?"); args.append(lastActivityAt) }
		if let todoID { sets.append("todo_id = ?"); args.append(todoID) }
		try db.execute(sql: "UPDATE followup_loops SET \(sets.joined(separator: ", ")) WHERE loop_id = ?", arguments: StatementArguments(args + [id]))
	}

	static func feedback(_ db: Database, fingerprint: String, outcome: String, reason: String? = nil) throws {
		try db.execute(sql: "INSERT INTO followup_feedback(id, fingerprint, outcome, reason, created_at) VALUES(?, ?, ?, ?, ?)",
		               arguments: [UUID().uuidString.lowercased(), fingerprint, outcome, reason.map { String($0.prefix(500)) }, TodoRecurrence.isoString(Date())])
	}

	static func setGraphStatus(_ db: Database, loopID: String, _ status: String) throws {
		guard let node = try GraphStore.node(db, id: loopID) else { return }
		_ = try GraphStore.write(db, nodes: [GraphNodeInput(type: "loop", key: node.key, props: ["status": .string(status)])])
	}

	static func meta(_ db: Database, _ key: String) throws -> String? { try String.fetchOne(db, sql: "SELECT value FROM graph_meta WHERE key = ?", arguments: ["followups:\(key)"]) }
	static func setMeta(_ db: Database, _ key: String, _ value: String) throws {
		try db.execute(sql: "INSERT INTO graph_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", arguments: ["followups:\(key)", value])
	}

	// MARK: Units (port of `units.ts`)

	static func groupKey(_ o: Observation) -> String { o.threadKey.map { "\(o.sourceID):\($0)" } ?? "\(o.sourceID):\(o.externalID)" }

	static func canOpen(_ observations: [Observation]) -> Bool {
		observations.contains { $0.sourceID.hasPrefix("plugin:") || $0.sourceID == "calendar" }
			&& !observations.allSatisfy { $0.facts["bulk"] == true || $0.facts["noReply"] == true || $0.facts["autoSubmitted"] == true }
	}

	static func text(_ observations: [Observation]) -> String {
		String(observations.suffix(20).map { o in
			let excerpt = String(MemoryText.collapseWhitespace(o.excerpt ?? "").prefix(1800))
			return "[evidenceId=\(o.nodeID)] \(o.occurredAt) \(o.direction ?? "") \(o.kind): \(o.title)\(excerpt.isEmpty ? "" : "\n\(excerpt)")"
		}.joined(separator: "\n\n").prefix(10000))
	}

	static func unit(_ db: Database, id: String, observations: [Observation], loops: [FollowupLoop], config: FollowupConfig, instructions: [String], now: Date) throws -> Unit {
		var nodeIDs: [String] = []
		for o in observations where !nodeIDs.contains(o.nodeID) { nodeIDs.append(o.nodeID) }
		let loopIDs = loops.map(\.loopID)
		let context = try GraphEnrichment.context(db, ids: nodeIDs + loopIDs, depth: 2, limit: 80, maxChars: 4500) { node in
			switch node.type {
			case "observation": return node.props["sourceId"]?.stringValue.map { config.sources[$0] != false } ?? true
			case "memory": return config.sources["memory"] != false
			case "event": return config.sources["calendar"] != false
			case "todo": return config.sources["toby.todos"] != false
			default: return true
			}
		}
		let identities = try ObservationLedger.selfIdentities(db)
		let latestEmail = observations.filter { $0.kind == "email.message" }.max { $0.occurredAt < $1.occurredAt }
		let waiting = latestEmail?.direction == "outbound"
			&& now.timeIntervalSince(TodoRecurrence.parseISO(latestEmail!.occurredAt) ?? now) >= config.awaitingReplyDays * 86400
		let loopText = loops.map { loop in
			"Open loop \(loop.loopID) (\(loop.kind)): \(loop.title)\(loop.counterpart.map { "; counterpart \($0)" } ?? "")\(loop.resolutionRejected ? "; reopened by the user at \(loop.reopenedAt ?? loop.lastActivityAt), require new evidence ingested after that time" : "")"
		}.joined(separator: "\n")
		let prompt = [
			"Evaluation time: \(TodoRecurrence.isoString(now))", "Awaiting-reply wait window elapsed: \(waiting)",
			"User identities: \(JSONValue.object(["emails": .array(identities.emails.map(JSONValue.string)), "handles": .array(identities.handles.map(JSONValue.string))]).jsonString())",
			instructions.isEmpty ? "" : "Follow-up instructions:\n\(instructions.joined(separator: "\n"))",
			"Follow-up settings: \(config.settingsJSON.jsonString())", loopText, context.text.isEmpty ? "" : "Graph context:\n\(context.text)",
		].filter { !$0.isEmpty }.joined(separator: "\n\n")
		let hashInput: JSONValue = [
			"observations": .array(observations.map { [.string($0.nodeID), .string($0.contentHash)] }),
			"loops": .array(loops.map { [.string($0.loopID), .string($0.status), .string($0.kind), .string($0.title), $0.counterpart.map(JSONValue.string) ?? .null, .bool($0.resolutionRejected), $0.reopenedAt.map(JSONValue.string) ?? .null] }),
			"context": .array(context.nodes.map { [.string($0.node.id), .string($0.node.label), .object($0.node.props)] }),
			"instructions": .array(instructions.map(JSONValue.string)), "decisionSettings": config.settingsJSON, "waitingReplyEligible": .bool(waiting),
		]
		return Unit(id: id, hash: sha(hashInput.jsonString()), nodeIDs: nodeIDs, loopIDs: loopIDs, waitingReplyEligible: waiting,
		            promptContext: String(prompt.prefix(6000)), sourceText: text(observations), evaluatedAt: TodoRecurrence.isoString(now))
	}

	static func units(_ db: Database, since: String, afterID: String?, config: FollowupConfig, now: Date) throws -> (units: [Unit], next: (String, String)?) {
		let page = try ObservationLedger.ingestedSince(db, since, limit: maxChanged, afterID: afterID)
		let next = page.count >= maxChanged ? page.last.map { ($0.ingestedAt, $0.id) } : nil
		let visible = try page.filter { o in try GraphStore.node(db, id: o.nodeID).map { GraphStore.isVisible($0, now: now) } ?? false }
		let enabled = visible.filter { config.sources[$0.sourceID] != false }
		var changedGroups: [(String, [Observation])] = []
		for o in enabled {
			let key = groupKey(o)
			if let index = changedGroups.firstIndex(where: { $0.0 == key }) { changedGroups[index].1.append(o) } else { changedGroups.append((key, [o])) }
		}
		var openGroups: [(String, [Observation])] = []
		for (key, changed) in changedGroups where canOpen(changed) {
			openGroups.append((key, try changed[0].threadKey.map { try ObservationLedger.thread(db, $0, limit: 20) } ?? changed))
		}
		let recent = try ObservationLedger.occurredSince(db, TodoRecurrence.isoString(now.addingTimeInterval(-ObservationLedger.retentionDays * 86400)), limit: 5000)
		var threads: [(String, [Observation])] = []
		for o in recent where config.sources[o.sourceID] != false && o.sourceID == "plugin:email" && o.kind == "email.message" && o.threadKey != nil {
			let key = groupKey(o)
			if let index = threads.firstIndex(where: { $0.0 == key }) { threads[index].1.append(o) } else { threads.append((key, [o])) }
		}
		for (key, messages) in threads {
			let ordered = messages.sorted { $0.occurredAt < $1.occurredAt }
			guard let latest = ordered.last, latest.direction == "outbound", canOpen(ordered),
			      now.timeIntervalSince(TodoRecurrence.parseISO(latest.occurredAt) ?? now) >= config.awaitingReplyDays * 86400,
			      !openGroups.contains(where: { $0.0 == key }) else { continue }
			openGroups.append((key, try ordered[0].threadKey.map { try ObservationLedger.thread(db, $0, limit: 20) } ?? ordered))
		}
		let open = try loops(db, status: "open")
		let byID = Dictionary(open.map { ($0.loopID, $0) }, uniquingKeysWith: { a, _ in a })
		var closeBy: [String: [FollowupLoop]] = [:]
		for o in enabled {
			for hit in try GraphStore.neighbors(db, from: [o.nodeID], depth: 2, nodeTypes: ["loop"], limit: 100) {
				if let loop = byID[hit.node.id] { closeBy[o.nodeID, default: []].append(loop) }
			}
		}
		let instructions = try String.fetchAll(db, sql: "SELECT text FROM followup_instructions ORDER BY created_at")
		var result: [Unit] = []
		for (key, thread) in openGroups {
			let changed = changedGroups.first { $0.0 == key }?.1 ?? []
			let cited = try GraphStore.edgesTouching(db, ids: thread.map(\.nodeID), edgeTypes: ["evidence_for"], fanout: 100).compactMap { byID[$0.src] }
			var unique: [String: FollowupLoop] = [:]
			for loop in cited + changed.flatMap({ closeBy[$0.nodeID] ?? [] }) { unique[loop.loopID] = loop }
			result.append(try unit(db, id: "open:\(key)", observations: thread, loops: unique.values.sorted { $0.loopID < $1.loopID }, config: config, instructions: instructions, now: now))
		}
		for o in visible {
			guard let loops = closeBy[o.nodeID], !loops.isEmpty else { continue }
			var unique: [String: FollowupLoop] = [:]
			for loop in loops { unique[loop.loopID] = loop }
			let id = "close:\(o.nodeID)"
			result.removeAll { $0.id == id }
			result.append(try unit(db, id: id, observations: [o], loops: Array(unique.values), config: config, instructions: instructions, now: now))
		}
		return (result, next)
	}

	// MARK: Apply (port of `scheduler.ts`)

	static func evidenceActivity(_ db: Database, _ ids: [String], fallback: String) throws -> String {
		var latest = TodoRecurrence.parseISO(fallback) ?? .distantPast
		for id in ids { if let at = try ObservationLedger.byNode(db, id).flatMap({ TodoRecurrence.parseISO($0.occurredAt) }) { latest = max(latest, at) } }
		return TodoRecurrence.isoString(latest)
	}

	static func addEvidence(_ db: Database, loopID: String, evidence: [String], reason: String, confidence: Double) throws {
		guard try GraphStore.node(db, id: loopID) != nil else { return }
		for id in evidence where try GraphStore.node(db, id: id) != nil {
			_ = try GraphStore.upsertEdge(db, src: loopID, dst: id, type: "evidence_for", weight: confidence, confidence: confidence, origin: "extracted", reason: reason)
			for edge in try GraphStore.edgesTouching(db, ids: [id], fanout: 100) {
				let related = edge.src == id ? edge.dst : edge.src
				guard let node = try GraphStore.node(db, id: related), node.visibility == "usable_by_ai",
				      ["person", "org", "project", "topic", "thread", "event"].contains(node.type) else { continue }
				_ = try GraphStore.upsertEdge(db, src: loopID, dst: related, type: "about", weight: edge.weight, confidence: edge.confidence, origin: "deterministic", provenanceNodeID: id)
			}
		}
	}

	func organizationID(_ kind: String, _ name: String) throws -> String {
		if let existing = try todos.organization(kind).first(where: { $0["name"]?.stringValue?.trimmingCharacters(in: .whitespaces).lowercased() == name.lowercased() })?["id"]?.stringValue { return existing }
		guard let id = try todos.saveOrganization(kind, id: nil, name: name, remove: false, context: TodoMutationContext(source: "followups", idempotencyKey: "followups:organization:\(kind):\(name.lowercased())"))["id"]?.stringValue else {
			throw TodoError.invalid("Could not create \(kind) \(name).")
		}
		return id
	}

	func createTodo(loopID: String, fingerprint: String, kind: String, title: String, counterpart: String?, due: String?, evidence: [String]) async throws -> String {
		let todoID = Self.todoID(fingerprint: fingerprint)
		if (try? todos.get(todoID)) == nil {
			let link = try await writer.read { db in try evidence.lazy.compactMap { try ObservationLedger.byNode(db, $0)?.url }.first }
			let details = ["Toby added this because it found evidence of \(kind.replacingOccurrences(of: "_", with: " "))\(counterpart.map { " involving \($0)" } ?? "").", link.map { "Source: \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: "\n")
			var input: [String: JSONValue] = ["title": .string(title), "description": .string(details), "listId": .string(try organizationID("list", "From Toby")), "tags": [.string(try organizationID("tag", "auto"))]]
			if let due, let date = TodoRecurrence.parseISO(due) {
				let iso = TodoRecurrence.isoString(date)
				input["due"] = ["date": .string(String(iso.prefix(10))), "time": .string(String(iso.dropFirst(11).prefix(5))), "timezone": "UTC"]
			}
			do {
				_ = try todos.create(.object(input), context: TodoMutationContext(source: "followups", idempotencyKey: "followup:\(loopID)", internalTodoId: todoID))
			} catch {
				guard (try? todos.get(todoID)) != nil else { throw error }
			}
		}
		let todo = try todos.get(todoID)
		try await writer.write { db in
			let todoNode = GraphNodeInput(type: "todo", key: todoID, label: todo["title"]?.stringValue, props: ["source": "followups", "status": todo["state"]?["status"] ?? "open"])
			if let loopNode = try GraphStore.node(db, id: loopID) {
				_ = try GraphStore.write(db, nodes: [todoNode], edges: [GraphEdgeInput(src: todoNode, dst: GraphNodeInput(type: "loop", key: loopNode.key), type: "tracks")])
			}
			try db.execute(sql: "UPDATE followup_loops SET todo_id = ?, updated_at = ? WHERE loop_id = ?", arguments: [todoID, TodoRecurrence.isoString(Date()), loopID])
		}
		return todoID
	}

	/// Open (or extend) a loop; returns whether a new one was created.
	func open(_ unit: Unit, now: Date, kind: String, title: String, counterpart: String?, due: String?, confidence: Double, evidenceIDs: [String]) async throws -> Bool {
		let evidence = try await writer.read { db in
			try evidenceIDs.filter { id in
				guard unit.nodeIDs.contains(id) else { return false }
				return try GraphStore.node(db, id: id) != nil
			}
		}
		guard !evidence.isEmpty else { return false }
		let same: @Sendable (FollowupLoop) -> Bool = { loop in loop.kind == kind && (kind != "commitment" || Self.normalized(loop.title) == Self.normalized(title)) }
		let merge: @Sendable (FollowupLoop) async throws -> Void = { [writer] loop in
			try await writer.write { db in
				let linked = Set(try GraphStore.edgesTouching(db, ids: [loop.loopID], edgeTypes: ["evidence_for"], fanout: 1000).filter { $0.src == loop.loopID }.map(\.dst))
				let fresh = evidence.filter { !linked.contains($0) }
				guard !fresh.isEmpty else { return }
				try Self.addEvidence(db, loopID: loop.loopID, evidence: fresh, reason: "New evidence supporting \(kind.replacingOccurrences(of: "_", with: " ")).", confidence: confidence)
				let activity = try Self.evidenceActivity(db, fresh, fallback: loop.lastActivityAt)
				if activity != loop.lastActivityAt { try Self.update(db, loop.loopID, lastActivityAt: activity, at: TodoRecurrence.isoString(Date())) }
			}
		}
		if let active = try await writer.read({ db in try unit.loopIDs.compactMap { try Self.loop(db, $0) }.first { $0.status == "open" && same($0) } }) {
			try await merge(active)
			return false
		}
		let base = kind == "commitment" ? Self.sha("\(kind)|\(unit.id)|\(Self.normalized(title))") : Self.sha("\(kind)|\(unit.id)")
		let (generations, fingerprints, nextFingerprint) = try await writer.read { db -> ([FollowupLoop], [String], String) in
			var generations: [FollowupLoop] = []
			var fingerprints: [String] = []
			for n in 0... {
				let fingerprint = n == 0 ? base : Self.sha("\(base)#\(n)")
				guard let loop = try Self.byFingerprint(db, fingerprint) else { return (generations, fingerprints, fingerprint) }
				generations.append(loop)
				fingerprints.append(fingerprint)
			}
			return (generations, fingerprints, base)
		}
		let negative = try await writer.read { db in
			try fingerprints.contains { try Bool.fetchOne(db, sql: "SELECT 1 FROM followup_feedback WHERE fingerprint = ? AND outcome IN ('dismissed', 'not_useful') LIMIT 1", arguments: [$0]) ?? false }
		}
		if generations.contains(where: { $0.status == "dismissed" }) || negative { return false }
		if let prior = generations.last {
			if prior.status == "open" { try await merge(prior); return false }
			let newest = try await writer.read { db in try Self.evidenceActivity(db, evidence, fallback: "1970-01-01T00:00:00.000Z") }
			if let settled = TodoRecurrence.parseISO(prior.updatedAt), let latest = TodoRecurrence.parseISO(newest), latest <= settled { return false }
		}
		let fingerprint = nextFingerprint
		let loopID = try await writer.write { db -> String in
			var props: [String: JSONValue] = ["kind": .string(kind), "status": "open", "title": .string(title)]
			if let counterpart { props["counterpart"] = .string(counterpart) }
			if let due { props["dueAt"] = .string(due) }
			let id = try GraphStore.write(db, nodes: [GraphNodeInput(type: "loop", key: fingerprint, label: title, props: props)]).nodeIDs[0]
			let at = TodoRecurrence.isoString(Date())
			try db.execute(sql: """
			INSERT INTO followup_loops(loop_id, kind, status, fingerprint, title, counterpart, due_at, confidence, todo_id, resolution_rejected, last_activity_at, created_at, updated_at)
			VALUES(?, ?, 'open', ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
			ON CONFLICT(fingerprint) DO UPDATE SET title = excluded.title, counterpart = excluded.counterpart, due_at = excluded.due_at,
			  confidence = excluded.confidence, last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at
			""", arguments: [id, kind, fingerprint, title, counterpart, due, confidence, try Self.evidenceActivity(db, evidence, fallback: TodoRecurrence.isoString(now)), at, at])
			try Self.addEvidence(db, loopID: id, evidence: evidence, reason: "Evidence supporting \(kind.replacingOccurrences(of: "_", with: " ")).", confidence: confidence)
			return try String.fetchOne(db, sql: "SELECT loop_id FROM followup_loops WHERE fingerprint = ?", arguments: [fingerprint]) ?? id
		}
		_ = try await createTodo(loopID: loopID, fingerprint: fingerprint, kind: kind, title: title, counterpart: counterpart, due: due, evidence: evidence)
		return true
	}

	func apply(_ units: [Unit], _ raw: JSONValue, config: FollowupConfig, now: Date) async throws -> (opened: Int, closed: Int, titles: [String], processed: Int) {
		var byID: [String: JSONValue] = [:]
		for entry in raw["units"]?.arrayValue ?? [] { if let id = entry["unitId"]?.stringValue { byID[id] = entry } }
		var opened = 0, closed = 0, processed = 0
		var titles: [String] = []
		let kindKeys = ["owe_reply": "oweReply", "awaiting_reply": "awaitingReply", "commitment": "commitment"]
		for unit in units {
			guard let evaluation = byID[unit.id] else { continue }
			processed += 1
			for item in unit.id.hasPrefix("open:") ? (evaluation["open"]?.arrayValue ?? []) : [] {
				guard let kind = item["kind"]?.stringValue, let key = kindKeys[kind], config.kinds[key] != false,
				      let title = item["title"]?.stringValue?.trimmingCharacters(in: .whitespaces), !title.isEmpty,
				      let confidence = item["confidence"]?.doubleValue, confidence >= config.openThreshold else { continue }
				let evidence = (item["evidenceIds"]?.arrayValue ?? []).compactMap(\.stringValue)
				if try await open(unit, now: now, kind: kind, title: String(title.prefix(200)), counterpart: item["counterpart"]?.stringValue?.nilIfEmpty,
				                  due: item["due"]?.stringValue?.nilIfEmpty.flatMap { TodoRecurrence.parseISO($0) != nil ? $0 : nil }, confidence: confidence, evidenceIDs: Array(evidence.prefix(5))) {
					opened += 1
				}
			}
			for item in evaluation["close"]?.arrayValue ?? [] {
				guard let loopID = item["loopId"]?.stringValue, let evidenceID = item["evidenceId"]?.stringValue, let confidence = item["confidence"]?.doubleValue,
				      confidence >= config.closeThreshold, unit.loopIDs.contains(loopID), unit.nodeIDs.contains(evidenceID),
				      let loop = try await writer.read({ db in try Self.loop(db, loopID) }), loop.status == "open" else { continue }
				if loop.resolutionRejected {
					let evidence = try await writer.read { db in try ObservationLedger.byNode(db, evidenceID) }
					guard let rejected = TodoRecurrence.parseISO(loop.reopenedAt ?? loop.lastActivityAt), let evidence,
					      let occurred = TodoRecurrence.parseISO(evidence.occurredAt), let ingested = TodoRecurrence.parseISO(evidence.ingestedAt),
					      occurred > rejected, ingested > rejected else { continue }
				}
				if config.autoComplete, let todoID = loop.todoID, let todo = try? todos.get(todoID), todo["deleted"] != true, todo["state"]?["status"] == "open" {
					_ = try? todos.transition(todoID, action: "complete", sequence: nil, allowIncompleteChecklist: true,
					                          context: TodoMutationContext(source: "followups", expectedRevision: todo["revision"]?.stringValue))
					titles.append(loop.title)
				}
				try await writer.write { db in
					try Self.addEvidence(db, loopID: loopID, evidence: [evidenceID], reason: String((item["reason"]?.stringValue ?? "Done").prefix(500)), confidence: confidence)
					try Self.update(db, loopID, status: "resolved", lastActivityAt: TodoRecurrence.isoString(now), at: TodoRecurrence.isoString(now))
					try Self.setGraphStatus(db, loopID: loopID, "resolved")
				}
				closed += 1
			}
			try await writer.write { db in
				for loopID in unit.loopIDs where try Self.loop(db, loopID)?.status == "open" {
					try db.execute(sql: "UPDATE followup_loops SET last_evaluated_hash = ? WHERE loop_id = ?", arguments: [unit.hash, loopID])
				}
				try db.execute(sql: "INSERT INTO followup_unit_hashes(unit_id, content_hash, evaluated_at) VALUES(?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET content_hash = excluded.content_hash, evaluated_at = excluded.evaluated_at",
				               arguments: [unit.id, unit.hash, TodoRecurrence.isoString(now)])
			}
		}
		return (opened, closed, titles, processed)
	}

	// MARK: Reconcile

	/// Sync loops with their todos (deleted → dismissed, user-completed →
	/// resolved, reopened → open again) and expire inactive ones.
	func reconcile(config: FollowupConfig, now: Date) async throws -> Int {
		let all = try await writer.read { db in try Self.loops(db, status: "open") + Self.loops(db, status: "resolved") }
		let at = TodoRecurrence.isoString(now)
		var changed = 0
		for loop in all {
			let writer = writer
			@Sendable func expireIfInactive() async throws -> Bool {
				guard loop.status == "open" else { return false }
				return try await writer.write { db -> Bool in
					let ids = try GraphStore.neighbors(db, from: [loop.loopID], depth: 2, nodeTypes: ["observation", "event", "todo"], limit: 200).compactMap { hit -> String? in
						guard let o = try ObservationLedger.byNode(db, hit.node.id), config.sources[o.sourceID] != false,
						      (TodoRecurrence.parseISO(o.occurredAt) ?? .distantFuture) <= now else { return nil }
						return hit.node.id
					}
					let last = try Self.evidenceActivity(db, ids, fallback: loop.lastActivityAt)
					if now.timeIntervalSince(TodoRecurrence.parseISO(last) ?? now) >= Self.expireDays * 86400 {
						try Self.update(db, loop.loopID, status: "expired", at: at)
						try Self.setGraphStatus(db, loopID: loop.loopID, "expired")
						return true
					}
					if last != loop.lastActivityAt { try Self.update(db, loop.loopID, lastActivityAt: last, at: TodoRecurrence.isoString(Date())); return true }
					return false
				}
			}
			guard let todoID = loop.todoID, let todo = try? todos.get(todoID) else {
				if try await expireIfInactive() { changed += 1 }
				continue
			}
			if todo["deleted"] == true {
				try await writer.write { db in
					try Self.update(db, loop.loopID, status: "dismissed", at: at)
					try Self.setGraphStatus(db, loopID: loop.loopID, "dismissed")
					try Self.feedback(db, fingerprint: loop.fingerprint, outcome: "dismissed", reason: "Todo deleted")
				}
				changed += 1
				continue
			}
			let history = (try? todos.historyOperations(todoID)) ?? []
			func hasState(_ op: JSONValue, _ status: String) -> Bool {
				(op["changes"]?.arrayValue ?? []).contains { $0["kind"] == "occurrence" && $0["fields"]?["state"]?["status"]?.stringValue == status }
			}
			let lastAutoComplete = history.lastIndex { $0["source"] == "followups" && hasState($0, "completed") }
			let reopen = lastAutoComplete.flatMap { index in history[(index + 1)...].last { $0["source"] != "followups" && hasState($0, "open") } }
			let status = todo["state"]?["status"]?.stringValue
			if status == "open", let reopen, let reopenAt = reopen["at"]?.stringValue, loop.status == "resolved" || !loop.resolutionRejected || loop.reopenedAt != reopenAt {
				try await writer.write { db in
					try Self.update(db, loop.loopID, status: "open", resolutionRejected: true, reopenedAt: reopenAt, lastActivityAt: reopenAt, at: reopenAt)
					try Self.setGraphStatus(db, loopID: loop.loopID, "open")
					try Self.feedback(db, fingerprint: loop.fingerprint, outcome: "reopened", reason: "User reopened auto-completed todo")
				}
				changed += 1
				continue
			}
			if status == "completed", loop.status == "open", history.last(where: { hasState($0, "completed") })?["source"] != "followups" {
				try await writer.write { db in
					try Self.update(db, loop.loopID, status: "resolved", at: at)
					try Self.setGraphStatus(db, loopID: loop.loopID, "resolved")
				}
				changed += 1
				continue
			}
			if try await expireIfInactive() { changed += 1 }
		}
		return changed
	}

	// MARK: Run

	static func systemPrompt(_ config: FollowupConfig) -> String {
		[
			"You are Toby's follow-up evaluator. Decide only from the provided evidence; do not invent facts.",
			"Create an item only when the user clearly owes a reply, is waiting on a reply after the configured wait, or made a concrete commitment.",
			"owe_reply: an inbound direct question or request still needs the user's answer. Example: 'Can you review the deck?' qualifies; 'Thanks!' does not.",
			"awaiting_reply: the user's outbound request remains unanswered after the wait window. Example: 'Can you send the invoice?' qualifies; an outbound FYI does not.",
			"commitment: the user promised a specific action. Example: 'I will send the deck Friday' qualifies; 'We should meet sometime' does not.",
			"For awaiting_reply, require that the message has been unanswered for at least the configured number of days as of the evaluation time.",
			"Do not create generic reminders from newsletters, automated mail, bulk messages, or no-reply senders.",
			"Close a loop only when new evidence clearly shows it is done. Acknowledgment or vague intent is not completion.",
			"Use only supplied unit IDs, loop IDs, and evidence IDs. Keep titles concise and action-oriented. Do not quote message bodies in titles.",
			"Enabled kinds: \(JSONValue.object(config.kinds.mapValues(JSONValue.bool)).jsonString()). Awaiting-reply wait: \(config.awaitingReplyDays.formatted(.number.grouping(.never))) days.",
		].joined(separator: "\n")
	}

	/// One pass: ingest, reconcile, prune, enrich, evaluate changed units.
	public func runOnce(now: Date = Date()) async -> Stats {
		if let running { return await running.value }
		let task = Task { await self.pass(now: now) }
		running = task
		let stats = await task.value
		running = nil
		return stats
	}

	func pass(now: Date) async -> Stats {
		let config = config()
		var stats = Stats()
		guard config.enabled else { stats.status = "disabled"; return stats }
		do {
			try await writer.write { db in _ = try GraphEnrichment.backfillMemories(db) }
			for source in sources where config.sources[source.id] ?? source.defaultEnabled {
				let result = await ObservationLedger.ingest(source: source, writer: writer, now: now)
				stats.ingested += result.created + result.updated
			}
			stats.reconciled = try await reconcile(config: config, now: now)
			_ = try await writer.write { db in try ObservationLedger.prune(db, now: now) }
			stats.enriched = try await GraphEnrichment.run(writer: writer, embedder: embedder(), extract: evaluate == nil || !ready() ? nil : extract, now: now).processed
			guard let evaluate, ready() else { stats.status = "setup_required"; stats.error = "Sign in with OpenRouter to find follow-ups."; return stats }
			let (since, afterID) = try await writer.read { db -> (String, String?) in
				let previous = try Self.meta(db, "last_run_at")
				return (previous ?? TodoRecurrence.isoString(now.addingTimeInterval(-14 * 86400)), previous == nil ? nil : (try Self.meta(db, "last_run_after_id")?.nilIfEmpty))
			}
			let page = try await writer.read { db in try Self.units(db, since: since, afterID: afterID, config: config, now: now) }
			let units = try await writer.read { db in
				try page.units.filter { try String.fetchOne(db, sql: "SELECT content_hash FROM followup_unit_hashes WHERE unit_id = ?", arguments: [$0.id]) != $0.hash }
			}
			stats.candidates = units.count
			let budgetKey = "followup_evaluations:\(GraphEnrichment.utcDay(now))"
			var processed = 0
			var titles: [String] = []
			var index = 0
			while index < units.count {
				let want = min(Self.batchSize, units.count - index)
				let allowed = try await writer.write { db in try GraphEnrichment.claimBudget(db, key: budgetKey, count: want, max: config.maxEvaluationsPerDay) }
				guard allowed > 0 else { break }
				let batch = Array(units[index ..< index + allowed])
				let payload: JSONValue = ["instructions": .string(batch.first?.promptContext ?? ""), "units": .array(batch.map { unit in
					["unitId": .string(unit.id), "evaluatedAt": .string(unit.evaluatedAt), "nodeIds": .array(unit.nodeIDs.map(JSONValue.string)), "loopIds": .array(unit.loopIDs.map(JSONValue.string)),
					 "waitingReplyEligible": .bool(unit.waitingReplyEligible), "evidence": .string(unit.sourceText), "graphContext": .string(unit.promptContext)]
				})]
				let result: (opened: Int, closed: Int, titles: [String], processed: Int)
				do {
					result = try await apply(batch, try await evaluate(payload.jsonString(), Self.systemPrompt(config)), config: config, now: now)
				} catch {
					try await refund(budgetKey, batch.count)
					throw error
				}
				try await refund(budgetKey, batch.count - result.processed)
				stats.opened += result.opened
				stats.closed += result.closed
				titles += result.titles
				processed += result.processed
				index += batch.count
			}
			stats.evaluated = processed
			if processed == units.count {
				try await writer.write { db in
					try Self.setMeta(db, "last_run_at", page.next?.0 ?? TodoRecurrence.isoString(now))
					try Self.setMeta(db, "last_run_after_id", page.next?.1 ?? "")
				}
			}
			if config.notifications, !titles.isEmpty { await notify(titles) }
		} catch {
			stats.status = "error"
			stats.error = (error as? LocalizedError)?.errorDescription ?? "\(error)"
		}
		return stats
	}

	func refund(_ key: String, _ count: Int) async throws {
		guard count > 0 else { return }
		try await writer.write { db in
			let used = Int(try String.fetchOne(db, sql: "SELECT value FROM graph_meta WHERE key = ?", arguments: [key]) ?? "0") ?? 0
			if used <= count { try db.execute(sql: "DELETE FROM graph_meta WHERE key = ?", arguments: [key]) } else {
				try db.execute(sql: "UPDATE graph_meta SET value = ? WHERE key = ?", arguments: [String(used - count), key])
			}
		}
	}

	/// Every `intervalMinutes` during active hours (7–22), after a 60s delay.
	public func runScheduler() async {
		try? await Task.sleep(for: .seconds(60))
		while !Task.isCancelled {
			let config = config()
			if config.enabled, (7 ..< 22).contains(Calendar.current.component(.hour, from: Date())) {
				let stats = await runOnce()
				if stats.status == "error" { TobyLog.shared.warn("followups", "followups_run_failed", ["error": .string(stats.error ?? "")]) }
			}
			try? await Task.sleep(for: .seconds(Double(config.intervalMinutes) * 60))
		}
	}

	// MARK: User actions

	/// "Not useful": delete the todo, dismiss the loop, remember the feedback.
	public func notUseful(_ loopID: String) async throws -> Bool {
		guard let loop = try await writer.read({ db in try Self.loop(db, loopID) }) else { return false }
		if let todoID = loop.todoID, let todo = try? todos.get(todoID), todo["deleted"] != true {
			_ = try todos.delete(todoID, context: TodoMutationContext(source: "followups", expectedRevision: todo["revision"]?.stringValue))
		}
		try await writer.write { db in
			try Self.update(db, loopID, status: "dismissed", at: TodoRecurrence.isoString(Date()))
			try Self.setGraphStatus(db, loopID: loopID, "dismissed")
			try Self.feedback(db, fingerprint: loop.fingerprint, outcome: "not_useful")
		}
		return true
	}

	/// A loop by id or by its todo id.
	func resolve(_ id: String) async throws -> FollowupLoop? {
		try await writer.read { db in
			try Self.loop(db, id) ?? Row.fetchOne(db, sql: "SELECT \(Self.loopColumns) FROM followup_loops WHERE todo_id = ?", arguments: [id]).map(FollowupLoop.init)
		}
	}

	/// Loop detail plus evidence (`GET /api/followups/:id`).
	public func detail(_ id: String) async throws -> JSONValue? {
		guard let loop = try await resolve(id) else { return nil }
		var out = loop.json.objectValue ?? [:]
		var evidence: JSONValue = []
		if let todoID = loop.todoID { evidence = try await explain(todoID: todoID)?["evidence"] ?? [] }
		out["evidence"] = evidence
		return .object(out)
	}

	/// Reopen an auto-completed todo; future closes need newer evidence.
	public func reopen(_ id: String) async throws -> JSONValue? {
		guard let loop = try await resolve(id), let todoID = loop.todoID, let todo = try? todos.get(todoID), todo["deleted"] != true,
		      todo["state"]?["status"] == "completed" else { return nil }
		_ = try todos.transition(todoID, action: "reopen", sequence: todo["sequence"]?.intValue, context: TodoMutationContext(source: "followups", expectedRevision: todo["revision"]?.stringValue))
		let at = TodoRecurrence.isoString(Date())
		try await writer.write { db in
			try Self.update(db, loop.loopID, status: "open", resolutionRejected: true, reopenedAt: at, lastActivityAt: at, at: at)
			try Self.setGraphStatus(db, loopID: loop.loopID, "open")
			try Self.feedback(db, fingerprint: loop.fingerprint, outcome: "reopened")
		}
		return try await resolve(loop.loopID)?.json
	}

	public func notUseful(id: String) async throws -> Bool {
		guard let loop = try await resolve(id) else { return false }
		return try await notUseful(loop.loopID)
	}

	// MARK: Instructions and sources

	public func instructions() async throws -> JSONValue {
		.array(try await writer.read { db in
			try Row.fetchAll(db, sql: "SELECT id, text, updated_at FROM followup_instructions ORDER BY created_at").map { ["id": .string($0["id"]), "text": .string($0["text"]), "updatedAt": .string($0["updated_at"])] }
		})
	}

	public func saveInstruction(id: String?, text: String) async throws -> JSONValue {
		let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
		guard !trimmed.isEmpty, text.count <= 2000 else { throw TodoError.invalid("text must be 1–2000 characters") }
		let existing = try await instructions().arrayValue ?? []
		if let id {
			guard existing.contains(where: { $0["id"]?.stringValue == id }) else { throw TodoError("not_found", "Instruction not found", status: 404) }
		} else if existing.count >= 20 {
			throw TodoError.invalid("You can keep up to 20 instructions.")
		}
		let instructionID = id ?? UUID().uuidString.lowercased()
		let at = TodoRecurrence.isoString(Date())
		try await writer.write { db in
			try db.execute(sql: "INSERT INTO followup_instructions(id, text, created_at, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
			               arguments: [instructionID, trimmed, at, at])
		}
		return ["id": .string(instructionID), "text": .string(trimmed)]
	}

	public func deleteInstruction(_ id: String) async throws {
		guard (try await instructions().arrayValue ?? []).contains(where: { $0["id"]?.stringValue == id }) else { throw TodoError("not_found", "Instruction not found", status: 404) }
		try await writer.write { db in try db.execute(sql: "DELETE FROM followup_instructions WHERE id = ?", arguments: [id]) }
	}

	public func sourcesJSON() async throws -> JSONValue {
		let config = config()
		var out: [JSONValue] = []
		for source in sources {
			let cursor = try await writer.read { db in
				try Row.fetchOne(db, sql: "SELECT last_error, last_success_at, ingested_count FROM observation_cursors WHERE source_id = ?", arguments: [source.id]).map { row -> JSONValue in
					var value: [String: JSONValue] = ["ingestedCount": .number(Double((row["ingested_count"] as Int?) ?? 0))]
					if let error = row["last_error"] as String? { value["lastError"] = .string(error) }
					if let success = row["last_success_at"] as String? { value["lastSuccessAt"] = .string(success) }
					return .object(value)
				}
			}
			out.append([
				"id": .string(source.id), "displayName": .string(source.displayName), "origin": .string(source.id.hasPrefix("plugin:") ? "plugin" : "core"),
				"evidenceOnly": .bool(source.evidenceOnly), "defaultEnabled": .bool(source.defaultEnabled), "enabled": .bool(config.sources[source.id] ?? source.defaultEnabled),
				"cursor": cursor ?? .null,
			])
		}
		return .array(out)
	}

	public static func statsJSON(_ stats: Stats) -> JSONValue {
		do {
			var out: [String: JSONValue] = [
				"status": .string(stats.status), "ingested": .number(Double(stats.ingested)), "enriched": .number(Double(stats.enriched)),
				"reconciled": .number(Double(stats.reconciled)), "candidates": .number(Double(stats.candidates)), "evaluated": .number(Double(stats.evaluated)),
				"opened": .number(Double(stats.opened)), "closed": .number(Double(stats.closed)),
			]
			if let error = stats.error { out["error"] = .string(error) }
			return .object(out)
		}
	}

	/// Why a "From Toby" todo exists: its loop and evidence.
	public func explain(todoID: String) async throws -> JSONValue? {
		try await writer.read { db in
			guard let loop = try Row.fetchOne(db, sql: "SELECT \(Self.loopColumns) FROM followup_loops WHERE todo_id = ?", arguments: [todoID]).map(FollowupLoop.init) else { return nil }
			let evidence = try GraphStore.edgesTouching(db, ids: [loop.loopID], edgeTypes: ["evidence_for"], fanout: 100).compactMap { edge -> JSONValue? in
				let id = edge.src == loop.loopID ? edge.dst : edge.src
				guard let node = try GraphStore.node(db, id: id) else { return nil }
				let observation = try ObservationLedger.byNode(db, id)
				var item: [String: JSONValue] = ["id": .string(id), "reason": .string(edge.reason ?? "Evidence related to this follow-up."),
				                                 "title": .string(observation?.title ?? node.label), "occurredAt": .string(observation?.occurredAt ?? node.updatedAt)]
				if let url = observation?.url { item["url"] = .string(url) }
				return .object(item)
			}
			return ["loop": ["loopId": .string(loop.loopID), "kind": .string(loop.kind), "status": .string(loop.status), "title": .string(loop.title), "todoId": .string(todoID)],
			        "evidence": .array(evidence)]
		}
	}
}
