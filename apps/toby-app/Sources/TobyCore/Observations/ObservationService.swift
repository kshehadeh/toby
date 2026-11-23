import Foundation
import GRDB
import TobyAI

/// One item from a source's recent activity (port of `observations/types.ts`).
public struct ObservationInput: Sendable, Equatable {
	public var externalID: String
	public var kind: String
	public var threadID: String?
	public var direction: String?
	public var occurredAt: String
	public var title: String
	public var excerpt: String?
	public var url: String?
	public var actors: [JSONValue] = []
	public var facts: [String: JSONValue] = [:]

	public init(externalID: String, kind: String, threadID: String? = nil, direction: String? = nil, occurredAt: String, title: String,
	            excerpt: String? = nil, url: String? = nil, actors: [JSONValue] = [], facts: [String: JSONValue] = [:]) {
		self.externalID = externalID
		self.kind = kind
		self.threadID = threadID
		self.direction = direction
		self.occurredAt = occurredAt
		self.title = title
		self.excerpt = excerpt
		self.url = url
		self.actors = actors
		self.facts = facts
	}
}

public struct ActivityResult: Sendable {
	public var observations: [ObservationInput]
	public var selfEmails: [String] = []
	public var selfHandles: [String] = []
}

/// A source of observations for the follow-up ledger.
public protocol ObservationSource: Sendable {
	var id: String { get }
	var displayName: String { get }
	var defaultEnabled: Bool { get }
	/// Evidence-only sources feed completion checks but never open follow-ups.
	var evidenceOnly: Bool { get }
	/// Items at or after `since`, oldest first, at most `limit`.
	func collect(since: String, limit: Int) async throws -> ActivityResult
}

public struct Observation: Sendable, Equatable {
	public var id: String
	public var nodeID: String
	public var sourceID: String
	public var externalID: String
	public var kind: String
	public var threadKey: String?
	public var direction: String?
	public var occurredAt: String
	public var title: String
	public var excerpt: String?
	public var url: String?
	public var actors: [JSONValue]
	public var facts: [String: JSONValue]
	public var contentHash: String
	public var ingestedAt: String

	init(_ row: Row) {
		id = row["id"]
		nodeID = row["node_id"]
		sourceID = row["source_id"]
		externalID = row["external_id"]
		kind = row["kind"]
		threadKey = row["thread_key"]
		direction = row["direction"]
		occurredAt = row["occurred_at"]
		title = row["title"]
		excerpt = row["excerpt"]
		url = row["url"]
		actors = ((row["actors_json"] as String?).flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) })?.arrayValue ?? []
		facts = ((row["facts_json"] as String?).flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) })?.objectValue ?? [:]
		contentHash = row["content_hash"]
		ingestedAt = row["ingested_at"]
	}
}

/// The observation ledger (port of `observations/store.ts`, `ingest.ts`, `run.ts`).
public enum ObservationLedger {
	static let columns = "id, node_id, source_id, external_id, kind, thread_key, direction, occurred_at, title, excerpt, url, actors_json, facts_json, content_hash, ingested_at"
	static let excerptMaxBytes = 2000
	static let initialLookback: TimeInterval = 14 * 86400
	static let cursorOverlap: TimeInterval = 3600
	public static let retentionDays = 45.0
	static let pageLimit = 500
	static let maxPages = 10
	static let volatileFacts: Set<String> = ["seen", "answered", "flagged"]

	// MARK: Store

	static func find(_ db: Database, source: String, external: String) throws -> Observation? {
		try Row.fetchOne(db, sql: "SELECT \(columns) FROM observations WHERE source_id = ? AND external_id = ?", arguments: [source, external]).map(Observation.init)
	}

	public static func byNode(_ db: Database, _ nodeID: String) throws -> Observation? {
		try Row.fetchOne(db, sql: "SELECT \(columns) FROM observations WHERE node_id = ? LIMIT 1", arguments: [nodeID]).map(Observation.init)
	}

	static func thread(_ db: Database, _ key: String, limit: Int = 50) throws -> [Observation] {
		try Row.fetchAll(db, sql: "SELECT \(columns) FROM (SELECT \(columns) FROM observations WHERE thread_key = ? ORDER BY occurred_at DESC LIMIT ?) ORDER BY occurred_at ASC", arguments: [key, max(1, limit)]).map(Observation.init)
	}

	static func ingestedSince(_ db: Database, _ since: String, limit: Int, afterID: String?) throws -> [Observation] {
		let filter = afterID == nil ? "ingested_at >= ?" : "(ingested_at > ? OR (ingested_at = ? AND id > ?))"
		let args: [any DatabaseValueConvertible] = afterID.map { [since, since, $0] } ?? [since]
		return try Row.fetchAll(db, sql: "SELECT \(columns) FROM observations WHERE \(filter) ORDER BY ingested_at ASC, id ASC LIMIT ?", arguments: StatementArguments(args + [max(1, limit)])).map(Observation.init)
	}

	static func occurredSince(_ db: Database, _ since: String, limit: Int) throws -> [Observation] {
		try Row.fetchAll(db, sql: "SELECT \(columns) FROM (SELECT \(columns) FROM observations WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?) ORDER BY occurred_at ASC", arguments: [since, limit]).map(Observation.init)
	}

	/// The user's identities across every source cursor.
	public static func selfIdentities(_ db: Database) throws -> (emails: [String], handles: [String]) {
		var emails: [String] = []
		var handles: [String] = []
		for raw in try String.fetchAll(db, sql: "SELECT self_json FROM observation_cursors ORDER BY source_id") {
			let value = (try? JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8))) ?? [:]
			for email in (value["emails"]?.arrayValue ?? []).compactMap(\.stringValue) where !emails.contains(email.lowercased()) { emails.append(email.trimmingCharacters(in: .whitespaces).lowercased()) }
			for handle in (value["handles"]?.arrayValue ?? []).compactMap(\.stringValue) where !handles.contains(handle) { handles.append(handle) }
		}
		return (emails, handles)
	}

	// MARK: Ingest

	static func boundedExcerpt(_ text: String) -> String {
		var bytes = Array(text.utf8)
		guard bytes.count > excerptMaxBytes else { return text }
		var end = excerptMaxBytes
		while end > 0, bytes[end] & 0xC0 == 0x80 { end -= 1 }
		bytes = Array(bytes[..<end])
		return String(decoding: bytes, as: UTF8.self)
	}

	/// Content hash, identical to the daemon's (volatile read/flag state excluded).
	public static func contentHash(_ input: ObservationInput) -> String {
		let facts = input.facts.filter { !volatileFacts.contains($0.key) }
		let value: JSONValue = [
			.string(input.kind), .string(input.title), .string(input.excerpt ?? ""), .string(input.direction ?? ""), .string(input.threadID ?? ""),
			.string(input.occurredAt), .object(facts),
			.array(input.actors.map { [$0["role"] ?? "", $0["email"] ?? "", $0["handle"] ?? ""] }),
		]
		return FeedText.sha(value.jsonString())
	}

	static func nodeType(_ kind: String) -> String { kind == "calendar.event" ? "event" : kind == "todo.item" ? "todo" : "observation" }

	static func isSelf(_ actor: JSONValue, emails: [String], handles: [String]) -> Bool {
		if let email = actor["email"]?.stringValue, emails.contains(email.trimmingCharacters(in: .whitespaces).lowercased()) { return true }
		return actor["handle"]?.stringValue.map(handles.contains) ?? false
	}

	static func personNode(source: String, actor: JSONValue, emails: [String], handles: [String]) -> GraphNodeInput? {
		let email = actor["email"]?.stringValue?.trimmingCharacters(in: .whitespaces)
		var key: String?
		if let email, email.contains("@") { key = GraphStore.emailPersonKey(email) } else if let handle = actor["handle"]?.stringValue {
			key = "handle:\(source):\(actor["scope"]?.stringValue ?? ""):\(handle)"
		}
		guard let key else { return nil }
		let label = actor["name"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? email?.nilIfEmpty ?? actor["handle"]?.stringValue ?? key
		var props: [String: JSONValue] = [:]
		if let email { props["email"] = .string(email.lowercased()) }
		if isSelf(actor, emails: emails, handles: handles) { props["self"] = true }
		return GraphNodeInput(type: "person", key: key, label: label, props: props)
	}

	public enum IngestStatus: String, Sendable { case new, updated, unchanged }

	/// Store one observation and link it into the graph (people, thread, mentions).
	@discardableResult
	public static func ingest(_ db: Database, source: String, raw: ObservationInput, emails: [String], handles: [String], now: Date = Date()) throws -> IngestStatus {
		var input = raw
		if let excerpt = input.excerpt { input.excerpt = boundedExcerpt(excerpt) }
		let hash = contentHash(input)
		let existing = try find(db, source: source, external: input.externalID)
		if let existing, existing.contentHash == hash { return .unchanged }
		var direction = input.direction
		if direction == nil, let author = input.actors.first(where: { $0["role"] == "from" || $0["role"] == "author" }) {
			direction = isSelf(author, emails: emails, handles: handles) ? "outbound" : "inbound"
		}
		let threadKey = input.threadID.map { "\(source):\($0)" }
		let type = nodeType(input.kind)
		var props: [String: JSONValue] = ["kind": .string(input.kind), "sourceId": .string(source), "occurredAt": .string(input.occurredAt), "text": .string(String((input.excerpt ?? "").prefix(500)))]
		if let direction { props["direction"] = .string(direction) }
		if let url = input.url { props["url"] = .string(url) }
		props.merge(input.facts) { _, fact in fact }
		let label = String(input.title.prefix(200))
		let node = GraphNodeInput(type: type, key: type == "todo" ? input.externalID : "\(source):\(input.externalID)", label: label.isEmpty ? input.kind : label, props: props)
		var edges: [GraphEdgeInput] = []
		if let threadKey { edges.append(GraphEdgeInput(src: node, dst: GraphNodeInput(type: "thread", key: threadKey, label: label), type: "in_thread")) }
		for actor in input.actors {
			guard let person = personNode(source: source, actor: actor, emails: emails, handles: handles) else { continue }
			switch actor["role"]?.stringValue {
			case "from", "author": edges.append(GraphEdgeInput(src: person, dst: node, type: "sent"))
			case "to": edges.append(GraphEdgeInput(src: node, dst: person, type: "received"))
			case "cc": edges.append(GraphEdgeInput(src: node, dst: person, type: "received", weight: 0.6))
			case "attendee", "organizer": edges.append(GraphEdgeInput(src: person, dst: node, type: "attends"))
			case "mentioned": edges.append(GraphEdgeInput(src: node, dst: person, type: "mentions"))
			default: break
			}
		}
		let enrich = input.kind == "todo.item" || input.facts["bulk"] == true ? ["embed"] : ["embed", "extract"]
		let nodeID = try GraphStore.write(db, nodes: [node], edges: edges, enrich: enrich).nodeIDs[0]
		let ingestedAt = TodoRecurrence.isoString(now)
		try db.execute(sql: """
		INSERT INTO observations (\(columns)) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source_id, external_id) DO UPDATE SET node_id = excluded.node_id, kind = excluded.kind, thread_key = excluded.thread_key,
		  direction = excluded.direction, occurred_at = excluded.occurred_at, title = excluded.title, excerpt = excluded.excerpt, url = excluded.url,
		  actors_json = excluded.actors_json, facts_json = excluded.facts_json, content_hash = excluded.content_hash, ingested_at = excluded.ingested_at
		""", arguments: [
			existing?.id ?? UUID().uuidString.lowercased(), nodeID, source, input.externalID, input.kind, threadKey, direction, input.occurredAt,
			input.title, input.excerpt, input.url, JSONValue.array(input.actors).jsonString(), JSONValue.object(input.facts).jsonString(), hash, ingestedAt,
		])
		return existing == nil ? .new : .updated
	}

	// MARK: Run

	public struct SourceStats: Sendable, Equatable {
		public var sourceID: String
		public var fetched = 0
		public var created = 0
		public var updated = 0
		public var unchanged = 0
		public var error: String?
	}

	/// Page through one source from its cursor and record the new cursor.
	public static func ingest(source: any ObservationSource, writer: any DatabaseWriter, now: Date = Date()) async -> SourceStats {
		var stats = SourceStats(sourceID: source.id)
		let at = TodoRecurrence.isoString(now)
		do {
			let cursor = try await writer.read { db in try String.fetchOne(db, sql: "SELECT since FROM observation_cursors WHERE source_id = ?", arguments: [source.id]) }
			var pageSince = cursor ?? TodoRecurrence.isoString(now.addingTimeInterval(-initialLookback))
			var emails: [String] = []
			var handles: [String] = []
			var drained = false
			for _ in 0 ..< maxPages {
				let result = try await source.collect(since: pageSince, limit: pageLimit)
				for email in result.selfEmails.map({ $0.trimmingCharacters(in: .whitespaces).lowercased() }) where !emails.contains(email) { emails.append(email) }
				for handle in result.selfHandles where !handles.contains(handle) { handles.append(handle) }
				stats.fetched += result.observations.count
				let (selfEmails, selfHandles) = (emails, handles)
				let statuses = try await writer.write { db in
					result.observations.map { item in (try? ingest(db, source: source.id, raw: item, emails: selfEmails, handles: selfHandles, now: now)) ?? .unchanged }
				}
				for status in statuses {
					switch status {
					case .new: stats.created += 1
					case .updated: stats.updated += 1
					case .unchanged: stats.unchanged += 1
					}
				}
				if result.observations.count < pageLimit { drained = true; break }
				guard let newest = result.observations.compactMap({ TodoRecurrence.parseISO($0.occurredAt) }).max(),
				      newest > (TodoRecurrence.parseISO(pageSince) ?? .distantPast) else { drained = true; break }
				pageSince = TodoRecurrence.isoString(newest)
			}
			let since = drained ? TodoRecurrence.isoString(now.addingTimeInterval(-cursorOverlap)) : pageSince
			let selfJSON: String? = emails.isEmpty && handles.isEmpty ? nil
				: JSONValue.object(["emails": .array(emails.map(JSONValue.string)), "handles": .array(handles.map(JSONValue.string))]).jsonString()
			let ingested = stats.created + stats.updated
			try await writer.write { db in
				try db.execute(sql: """
				INSERT INTO observation_cursors (source_id, since, last_run_at, last_success_at, last_error, self_json, ingested_count)
				VALUES (?, ?, ?, ?, NULL, ?, ?)
				ON CONFLICT(source_id) DO UPDATE SET since = excluded.since, last_run_at = excluded.last_run_at, last_success_at = excluded.last_success_at,
				  last_error = NULL, self_json = COALESCE(?, self_json), ingested_count = ingested_count + excluded.ingested_count
				""", arguments: [source.id, since, at, at, selfJSON ?? #"{"emails":[],"handles":[]}"#, ingested, selfJSON])
			}
		} catch {
			let message = String(((error as? LocalizedError)?.errorDescription ?? "\(error)").prefix(500))
			stats.error = message
			try? await writer.write { db in
				try db.execute(sql: """
				INSERT INTO observation_cursors (source_id, last_run_at, last_error) VALUES (?, ?, ?)
				ON CONFLICT(source_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_error = excluded.last_error
				""", arguments: [source.id, at, message])
			}
		}
		return stats
	}

	/// Drop observations past retention unless an open loop cites them.
	@discardableResult
	public static func prune(_ db: Database, now: Date = Date()) throws -> Int {
		let cutoff = TodoRecurrence.isoString(now.addingTimeInterval(-retentionDays * 86400))
		var removed = 0
		while true {
			let batch = try Row.fetchAll(db, sql: """
			SELECT id, node_id FROM observations o WHERE o.occurred_at < ? AND o.ingested_at < ?
			AND NOT EXISTS (SELECT 1 FROM graph_edges e JOIN followup_loops l ON l.loop_id = e.src WHERE e.type = 'evidence_for' AND e.dst = o.node_id AND l.status = 'open')
			LIMIT 500
			""", arguments: [cutoff, cutoff]).map { ($0["id"] as String, $0["node_id"] as String) }
			for (id, nodeID) in batch {
				if let node = try GraphStore.node(db, id: nodeID), node.type != "todo" { _ = try GraphStore.deleteNode(db, id: node.id) }
				try db.execute(sql: "DELETE FROM observations WHERE id = ?", arguments: [id])
				removed += 1
			}
			if batch.count < 500 { break }
		}
		return removed
	}
}

// MARK: Core sources (port of `observations/sources.ts`)

public enum ObservationSources {
	public static let selfHandle = "toby-user"
}

/// The user's own words in Toby chats (evidence only).
public struct ChatObservationSource: ObservationSource {
	let sessions: ChatSessionStore
	let writer: any DatabaseWriter
	public init(sessions: ChatSessionStore, writer: any DatabaseWriter) {
		self.sessions = sessions
		self.writer = writer
	}

	public var id: String { "toby.chat" }
	public var displayName: String { "Toby chats" }
	public var defaultEnabled: Bool { true }
	public var evidenceOnly: Bool { true }

	public func collect(since: String, limit: Int) async throws -> ActivityResult {
		var out: [ObservationInput] = []
		for summary in try sessions.list(limit: 100) where (summary["updatedAt"]?.stringValue ?? "") >= since && summary["sourceIntegration"]?.stringValue == nil {
			guard let id = summary["id"]?.stringValue, let session = try sessions.load(id) else { continue }
			for (index, message) in session.messages.enumerated() where message.role == .user {
				let text = MemoryText.collapseWhitespace(message.text)
				guard text.count >= 8 else { continue }
				let external = "\(id):\(index)"
				let occurredAt = try await writer.read { db in try ObservationLedger.find(db, source: "toby.chat", external: external)?.occurredAt } ?? (summary["updatedAt"]?.stringValue ?? since)
				out.append(ObservationInput(
					externalID: external, kind: "chat.message", threadID: id, direction: "outbound", occurredAt: occurredAt, title: String(text.prefix(160)),
					excerpt: String(text.prefix(2000)), url: "toby://chat/\(id)", actors: [["role": "author", "handle": .string(ObservationSources.selfHandle), "name": "You"]], facts: ["tobyChat": true],
				))
			}
		}
		return ActivityResult(observations: Array(out.sorted { $0.occurredAt < $1.occurredAt }.prefix(limit)), selfHandles: [ObservationSources.selfHandle])
	}
}

/// Toby todos (evidence only).
public struct TodoObservationSource: ObservationSource {
	let todos: TodoService
	public init(todos: TodoService) { self.todos = todos }
	public var id: String { "toby.todos" }
	public var displayName: String { "Toby Todos" }
	public var defaultEnabled: Bool { true }
	public var evidenceOnly: Bool { true }

	public func collect(since: String, limit: Int) async throws -> ActivityResult {
		let list = try todos.list(["status": "all", "limit": 200])["todos"]?.arrayValue ?? []
		return ActivityResult(observations: list.compactMap { todo in
			guard let id = todo["id"]?.stringValue, let updated = todo["updatedAt"]?.stringValue, updated >= since else { return nil }
			var facts: [String: JSONValue] = ["status": todo["state"]?["status"] ?? "open", "listId": todo["listId"] ?? .null]
			if let due = todo["due"]?["date"]?.stringValue { facts["due"] = .string(due) }
			if todo["deleted"] == true { facts["deleted"] = true }
			let description = (todo["description"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			return ObservationInput(externalID: id, kind: "todo.item", occurredAt: updated, title: todo["title"]?.stringValue ?? "",
			                        excerpt: description.isEmpty ? nil : description, url: "toby://todos/\(id)", facts: facts)
		})
	}
}

/// Memory graph nodes (evidence only).
public struct MemoryObservationSource: ObservationSource {
	let writer: any DatabaseWriter
	public init(writer: any DatabaseWriter) { self.writer = writer }
	public var id: String { "memory" }
	public var displayName: String { "Memories" }
	public var defaultEnabled: Bool { true }
	public var evidenceOnly: Bool { true }

	public func collect(since: String, limit: Int) async throws -> ActivityResult {
		let nodes = try await writer.read { db in
			try Row.fetchAll(db, sql: "SELECT id FROM graph_nodes WHERE type = 'memory' AND updated_at >= ? ORDER BY updated_at ASC LIMIT ?", arguments: [since, limit])
				.map { $0["id"] as String }
		}
		let loaded = try await writer.read { db in try GraphStore.nodes(db, ids: nodes) }
		return ActivityResult(observations: loaded.filter { GraphStore.isVisible($0) }.sorted { $0.updatedAt < $1.updatedAt }.map { node in
			var facts: [String: JSONValue] = [:]
			if let expires = node.props["expiresAt"]?.stringValue { facts["expiresAt"] = .string(expires) }
			if let type = node.props["memoryType"]?.stringValue { facts["memoryType"] = .string(type) }
			return ObservationInput(externalID: node.key, kind: "memory.item", occurredAt: node.updatedAt, title: node.label, excerpt: node.props["text"]?.stringValue ?? "", facts: facts)
		})
	}
}

/// Upcoming calendar events (ignores `since`; content hashes skip unchanged).
public struct CalendarObservationSource: ObservationSource {
	let apple: AppleTools
	let writer: any DatabaseWriter
	public init(apple: AppleTools, writer: any DatabaseWriter) {
		self.apple = apple
		self.writer = writer
	}

	public var id: String { "calendar" }
	public var displayName: String { "Calendar" }
	public var defaultEnabled: Bool { true }
	public var evidenceOnly: Bool { false }

	public func collect(since: String, limit: Int) async throws -> ActivityResult {
		let items = try await apple.upcomingEvents(limit: 40)["items"]?.arrayValue ?? []
		var out: [ObservationInput] = []
		for item in items {
			let external = "applecalendar:\(item["id"]?.stringValue ?? "")"
			let firstSeen = try await writer.read { db in try ObservationLedger.find(db, source: "calendar", external: external)?.occurredAt }
			var facts: [String: JSONValue] = [:]
			if let calendar = item["subtitle"]?.stringValue { facts["calendar"] = .string(calendar) }
			if let location = item["event"]?["location"]?.stringValue { facts["location"] = .string(location) }
			if let count = item["event"]?["attendeeCount"], count.doubleValue != nil { facts["attendeeCount"] = count }
			if item["event"]?["allDay"] == true { facts["allDay"] = true }
			if item["event"]?["recurring"] == true { facts["recurring"] = true }
			out.append(ObservationInput(
				externalID: external, kind: "calendar.event", occurredAt: item["timestamp"]?.stringValue ?? firstSeen ?? TodoRecurrence.isoString(Date()),
				title: item["title"]?.stringValue?.nilIfEmpty ?? "(untitled event)", excerpt: item["event"]?["notes"]?.stringValue, url: item["url"]?.stringValue, facts: facts,
			))
		}
		return ActivityResult(observations: out)
	}
}

/// Recent INBOX + Sent mail (`plugin:email`, the id the daemon used).
public struct MailObservationSource: ObservationSource {
	let mail: MailService
	public init(mail: MailService) { self.mail = mail }
	public var id: String { "plugin:email" }
	public var displayName: String { "Email" }
	public var defaultEnabled: Bool { true }
	public var evidenceOnly: Bool { false }
	public func collect(since: String, limit: Int) async throws -> ActivityResult {
		guard mail.isConfigured else { throw MailServiceError.notConnected }
		return try await mail.recentActivity(since: since, limit: limit)
	}
}

/// Mentions, DMs, and the user's own Slack messages (`plugin:slack`).
public struct SlackObservationSource: ObservationSource {
	let slack: SlackService
	public init(slack: SlackService) { self.slack = slack }
	public var id: String { "plugin:slack" }
	public var displayName: String { "Slack" }
	public var defaultEnabled: Bool { true }
	public var evidenceOnly: Bool { false }
	public func collect(since: String, limit: Int) async throws -> ActivityResult {
		guard slack.isConfigured else { throw SlackError.notConfigured("Slack isn't connected.") }
		return try await slack.recentActivity(since: since, limit: limit)
	}
}

public enum MailServiceError: Error, LocalizedError {
	case notConnected
	public var errorDescription: String? { "Email isn't connected." }
}
