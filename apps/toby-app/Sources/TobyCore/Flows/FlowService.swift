import Foundation
import GRDB
import TobyAI

/// The app's macOS event source (wake, return after idle, folder changes).
public protocol FlowEventSource: Sendable {
	/// Subscribe `owner` to `types` with folder `watches`; returns `{sessionId, sequence, folderErrors?, idleAvailable?}`.
	func subscribe(owner: String, types: [String], watches: [JSONValue]) async throws -> JSONValue
	/// Events after `sequence`: `{events, sequence, gap?}`.
	func events(session: String, after: Int, limit: Int) async throws -> JSONValue
	func notifyCompletion(flowID: String, runID: String?, name: String, success: Bool) async
}

/// Flows: definitions, runs, triggers (manual, Home, schedule, macOS events)
/// and the trigger supervisor (port of `flows/triggers/*` and the flow handlers).
public actor FlowService {
	let writer: any DatabaseWriter
	let runner: FlowRunner
	let events: (any FlowEventSource)?
	let ai: OpenRouterClient
	let owner = UUID().uuidString
	var cursor: (session: String, sequence: Int)?
	var activeTypes = ""
	public private(set) var sourceStatus: JSONValue = ["state": "idle", "message": "No enabled macOS triggers", "lastPollAt": .null]
	var workers = 0

	public init(writer: any DatabaseWriter, runner: FlowRunner, events: (any FlowEventSource)?, ai: OpenRouterClient) {
		self.writer = writer
		self.runner = runner
		self.events = events
		self.ai = ai
	}

	// MARK: Definitions API

	func serialize(_ record: FlowDocuments.Record) -> JSONValue {
		let document = record.document
		let catalog = runner.tools.catalog().tools
		let nodes: [JSONValue] = (FlowRunner.snapshot(document)["nodes"]?.arrayValue ?? []).map { node in
			guard let tool = node["tool"], var object = node.objectValue else { return node }
			if let match = FlowDocuments.resolve(tool, in: catalog) {
				var display: [String: JSONValue] = ["title": .string(match.displayName), "description": .string(match.description), "integrationName": .string(match.moduleName)]
				display["integrationDisplayName"] = .string(match.moduleName == "tobyTodos" ? "Toby Todos" : runner.tools.catalog().modules.first { $0["name"]?.stringValue == match.moduleName }?["displayName"]?.stringValue ?? match.moduleName)
				object["display"] = .object(display)
			}
			return .object(object)
		}
		return [
			"id": .string(record.id), "name": .string(record.name), "description": record.description.map(JSONValue.string) ?? .null,
			"icon": document["icon"] ?? .null, "color": document["color"] ?? .null, "builtin": .bool(record.builtin), "triggers": document["triggers"] ?? [],
			"projectId": document["projectId"] ?? .null, "persona": document["persona"] ?? ["source": "default"], "nodes": .array(nodes),
			"result": document["result"] ?? .null, "destinations": document["destinations"] ?? [], "createdAt": .string(record.createdAt), "updatedAt": .string(record.updatedAt),
		]
	}

	public func list() throws -> JSONValue {
		let records = try writer.read { db in try FlowDocuments.list(db) }
		return ["flows": .array(records.map(serialize))]
	}

	public func detail(_ id: String) throws -> JSONValue? {
		guard let record = try writer.read({ db in try FlowDocuments.load(db, id) }) else { return nil }
		return ["flow": serialize(record), "document": .object(record.document)]
	}

	public func catalog() -> JSONValue { ["modules": .array(runner.tools.catalog().modules)] }

	/// Create (`id == nil`) or update a user flow from a request body.
	public func save(_ body: JSONValue, id: String?) throws -> JSONValue {
		let flowID = id ?? "flow.\(UUID().uuidString.lowercased())"
		if let id {
			guard let existing = try writer.read({ db in try FlowDocuments.load(db, id) }) else { throw TodoError("not_found", "Flow not found", status: 404) }
			if existing.builtin { throw TodoError("forbidden", "Built-in flows can’t be edited", status: 403) }
		}
		let catalog = runner.tools.catalog()
		let document = try FlowDocuments.validate(try FlowDocuments.parse(body, id: flowID), tools: catalog.tools, connected: catalog.connected)
		let record = try writer.write { db in try FlowDocuments.save(db, document) }
		return ["flow": serialize(record), "document": .object(record.document)]
	}

	public func delete(_ id: String) throws {
		guard try writer.read({ db in try FlowDocuments.load(db, id) }) != nil else { throw TodoError("not_found", "Flow not found", status: 404) }
		_ = try writer.write { db in try FlowDocuments.delete(db, id) }
	}

	public func runs(flowName: String?, limit: Int, offset: Int) throws -> JSONValue {
		["runs": .array(try runner.runs(flowName: flowName, limit: max(1, min(200, limit)), offset: max(0, offset)))]
	}

	public func runDetail(_ id: String) throws -> JSONValue? {
		guard let run = try runner.run(id: id) else { return nil }
		return ["run": run, "nodes": run["nodes"] ?? []]
	}

	/// Natural language → cron: literal cron, common phrases, then the fast model.
	public func parseCron(_ input: String) async throws -> String {
		let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty else { throw TodoError.invalid("input is required") }
		if let cron = CronLanguage.pattern(text) { return cron }
		let reply = try await generateText(TextRequest(model: ai.model(ModelDefaults.fast), instructions: CronLanguage.systemPrompt, messages: [.user(text)], temperature: 0, maxOutputTokens: 20))
		let candidate = reply.text.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).prefix(5).joined(separator: " ")
		guard CronExpression(candidate) != nil else {
			throw TodoError.invalid("AI returned an invalid cron expression \"\(candidate)\" for \"\(text)\". Try rephrasing or use a standard cron expression like \"0 9 * * *\".")
		}
		return candidate
	}

	// MARK: Bindings and decisions (port of `triggers/store.ts`)

	struct Binding: Sendable {
		var id: String
		var revision: Int
		var flowID: String
		var trigger: JSONValue
		var document: [String: JSONValue]
		var createdAt: String

		var json: JSONValue {
			["id": .string(id), "revision": .number(Double(revision)), "flowId": .string(flowID), "trigger": trigger, "document": .object(document), "createdAt": .string(createdAt)]
		}

		init(id: String, revision: Int, flowID: String, trigger: JSONValue, document: [String: JSONValue], createdAt: String) {
			self.id = id
			self.revision = revision
			self.flowID = flowID
			self.trigger = trigger
			self.document = document
			self.createdAt = createdAt
		}

		init?(_ json: JSONValue) {
			guard let id = json["id"]?.stringValue, let flowID = json["flowId"]?.stringValue, let document = json["document"]?.objectValue else { return nil }
			self.init(id: id, revision: json["revision"]?.intValue ?? 0, flowID: flowID, trigger: json["trigger"] ?? [:], document: document, createdAt: json["createdAt"]?.stringValue ?? "")
		}
	}

	static func bindings(_ db: Database) throws -> [Binding] {
		try FlowDocuments.list(db).filter { !$0.builtin }.flatMap { record in
			((try? FlowDocuments.triggers(record.document["triggers"])) ?? []).map { trigger in
				Binding(id: "\(record.id)/\(trigger["id"]?.stringValue ?? "")", revision: record.document["revision"]?.intValue ?? 0, flowID: record.id,
				        trigger: trigger, document: record.document, createdAt: record.createdAt)
			}
		}
	}

	static func userInvoked(_ type: String) -> Bool { type == "manual" || type == "home.action" }

	/// Local day, weekday (0 = Sunday), and HH:MM in `timezone`.
	static func local(_ date: Date, _ timezone: String) -> (day: String, weekday: Int, time: String) {
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = TimeZone(identifier: timezone) ?? .current
		let parts = calendar.dateComponents([.year, .month, .day, .weekday, .hour, .minute], from: date)
		return (String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!), parts.weekday! - 1, String(format: "%02d:%02d", parts.hour!, parts.minute!))
	}

	static func inputs(_ binding: Binding, event: JSONValue, runID: String) throws -> [String: JSONValue] {
		var out = binding.trigger["inputs"]?.objectValue ?? [:]
		for (key, path) in binding.trigger["eventInputMappings"]?.objectValue ?? [:] {
			guard let value = FlowRunner.value(event, path: path.stringValue) else { throw FlowRunner.NodeError("Event has no field \(path.stringValue ?? "")") }
			out[key] = value
		}
		out["trigger"] = ["id": binding.trigger["id"] ?? "", "runId": .string(runID), "event": event]
		return out
	}

	/// Why a binding doesn't run for an event, or nil when it should.
	static func reason(_ db: Database, _ binding: Binding, _ event: JSONValue, now: Date) throws -> String? {
		let trigger = binding.trigger
		guard trigger["enabled"] == true else { return "disabled" }
		let type = trigger["source"]?["type"]?.stringValue ?? ""
		guard type == event["type"]?.stringValue else { return "trigger_mismatch" }
		let state = try Row.fetchOne(db, sql: "SELECT last_claim_at, claimed_day FROM flow_trigger_state WHERE binding_id = ?", arguments: [binding.id])
			.map { (lastClaim: $0["last_claim_at"] as String?, day: $0["claimed_day"] as String?) }
		let timezone = trigger["conditions"]?["timezone"]?.stringValue ?? TimeZone.current.identifier
		if type.hasPrefix("macos.") {
			if type == "macos.fileChanges", event["payload"]?["watchId"]?.stringValue != "\(binding.id):\(binding.revision)" { return "watch_mismatch" }
			let age = now.timeIntervalSince(TodoRecurrence.parseISO(event["occurredAt"]?.stringValue ?? "") ?? .distantPast)
			if age > 120 || age < -5 { return "stale_event" }
			if type == "macos.userReturned", (event["payload"]?["idleSeconds"]?.doubleValue ?? 0) < (trigger["source"]?["minimumIdleSeconds"]?.doubleValue ?? 1800) { return "idle_threshold" }
		}
		if !userInvoked(type) {
			let local = Self.local(TodoRecurrence.parseISO(event["occurredAt"]?.stringValue ?? "") ?? now, timezone)
			if let weekdays = trigger["conditions"]?["weekdays"]?.arrayValue?.compactMap(\.intValue), !weekdays.contains(local.weekday) { return "weekday" }
			if let window = trigger["conditions"]?["timeWindow"], let start = window["start"]?.stringValue, let end = window["end"]?.stringValue {
				let inside = start < end ? (local.time >= start && local.time < end) : (local.time >= start || local.time < end)
				if !inside { return "time_window" }
			}
			if trigger["policy"]?["oncePerDay"] == true, state?.day == Self.local(now, timezone).day { return "daily_limit" }
			if let last = state?.lastClaim.flatMap(TodoRecurrence.parseISO), now.timeIntervalSince(last) < (trigger["policy"]?["cooldownSeconds"]?.doubleValue ?? 0) { return "cooldown" }
		}
		do { _ = try inputs(binding, event: event, runID: "preview") } catch { return (error as? LocalizedError)?.errorDescription ?? "\(error)" }
		if type != "macos.fileChanges",
		   try String.fetchOne(db, sql: "SELECT id FROM flow_trigger_decisions WHERE binding_id = ? AND status IN ('pending','running')", arguments: [binding.id]) != nil { return "busy" }
		return (try Int.fetchOne(db, sql: "SELECT count(*) FROM flow_trigger_decisions WHERE status = 'pending'") ?? 0) >= 100 ? "capacity" : nil
	}

	/// Record a decision (pending or skipped); nil when this occurrence was seen.
	@discardableResult
	static func enqueue(_ db: Database, _ binding: Binding, event: JSONValue, now: Date = Date(), occurrence: String? = nil) throws -> String? {
		let occurrenceID = occurrence ?? event["id"]?.stringValue ?? UUID().uuidString
		if try String.fetchOne(db, sql: "SELECT id FROM flow_trigger_decisions WHERE binding_id = ? AND occurrence_id = ?", arguments: [binding.id, occurrenceID]) != nil { return nil }
		let why = try reason(db, binding, event, now: now)
		let id = UUID().uuidString.lowercased()
		try db.execute(sql: """
		INSERT INTO flow_trigger_decisions (id, binding_id, flow_id, occurrence_id, binding_json, event_json, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		""", arguments: [id, binding.id, binding.flowID, occurrenceID, binding.json.jsonString(), event.jsonString(), why == nil ? "pending" : "skipped", why, TodoRecurrence.isoString(now)])
		if why == nil, !userInvoked(binding.trigger["source"]?["type"]?.stringValue ?? "") {
			let timezone = binding.trigger["conditions"]?["timezone"]?.stringValue ?? TimeZone.current.identifier
			try db.execute(sql: "INSERT INTO flow_trigger_state VALUES (?, ?, ?) ON CONFLICT(binding_id) DO UPDATE SET last_claim_at = excluded.last_claim_at, claimed_day = excluded.claimed_day",
			               arguments: [binding.id, TodoRecurrence.isoString(now), local(now, timezone).day])
		}
		return id
	}

	static func finish(_ db: Database, _ id: String, status: String, reason: String?, runID: String? = nil, output: String? = nil) throws {
		try db.execute(sql: "UPDATE flow_trigger_decisions SET status = ?, reason = ?, flow_run_id = ?, output = ? WHERE id = ?", arguments: [status, reason, runID, output, id])
	}

	/// Claim the next runnable decision (≤ 2 running, one per flow).
	static func claim(_ db: Database, now: Date, id: String? = nil) throws -> (id: String, binding: Binding, event: JSONValue)? {
		guard (try Int.fetchOne(db, sql: "SELECT count(*) FROM flow_trigger_decisions WHERE status = 'running'") ?? 0) < 2 else { return nil }
		let rows = try Row.fetchAll(db, sql: """
		SELECT id, binding_json, event_json FROM flow_trigger_decisions AS pending WHERE (? IS NULL OR id = ?) AND status = 'pending'
		AND NOT EXISTS (SELECT 1 FROM flow_trigger_decisions AS active WHERE active.flow_id = pending.flow_id AND active.status = 'running') ORDER BY created_at, rowid
		""", arguments: [id, id]).map { ($0["id"] as String, FlowRunner.parse($0["binding_json"]), FlowRunner.parse($0["event_json"])) }
		for (decisionID, bindingJSON, event) in rows {
			guard let binding = Binding(bindingJSON) else { try finish(db, decisionID, status: "skipped", reason: "invalid"); continue }
			let current = try FlowDocuments.load(db, binding.flowID).flatMap { record in
				(try? FlowDocuments.triggers(record.document["triggers"]))?.first { $0["id"] == binding.trigger["id"] }
			}
			var why: String? = current == nil ? "deleted" : current?["enabled"] != true ? "disabled" : nil
			if (event["type"]?.stringValue ?? "").hasPrefix("macos."), now.timeIntervalSince(TodoRecurrence.parseISO(event["occurredAt"]?.stringValue ?? "") ?? .distantPast) > 120 { why = "stale_event" }
			if let why { try finish(db, decisionID, status: "skipped", reason: why); continue }
			try db.execute(sql: "UPDATE flow_trigger_decisions SET status = 'running' WHERE id = ?", arguments: [decisionID])
			return (decisionID, binding, event)
		}
		return nil
	}

	/// Enqueue the latest due occurrence of every enabled schedule.
	static func enqueueSchedules(_ db: Database, now: Date = Date()) throws {
		for binding in try bindings(db) where binding.trigger["enabled"] == true && binding.trigger["source"]?["type"] == "schedule" {
			let timezone = TimeZone(identifier: binding.trigger["conditions"]?["timezone"]?.stringValue ?? "") ?? .current
			guard let cron = binding.trigger["source"]?["cron"]?.stringValue.flatMap(CronExpression.init), let occurrence = cron.previous(before: now, timezone: timezone),
			      occurrence >= (TodoRecurrence.parseISO(binding.createdAt) ?? .distantPast) else { continue }
			if binding.trigger["source"]?["missedRuns"] == "skip", now.timeIntervalSince(occurrence) > 60 { continue }
			let at = TodoRecurrence.isoString(occurrence)
			try enqueue(db, binding, event: ["id": .string("schedule:\(binding.id):\(at)"), "type": "schedule", "occurredAt": .string(at), "payload": [:]], now: now)
		}
	}

	// MARK: Running

	public struct RunOutcome: Sendable {
		public var json: JSONValue
		public var insufficientCredits: Bool
	}

	/// Run a decision to completion and record the outcome.
	func work(_ claimed: (id: String, binding: Binding, event: JSONValue)) async -> FlowRunner.Result {
		let inputs: [String: JSONValue]
		do { inputs = try Self.inputs(claimed.binding, event: claimed.event, runID: claimed.id) } catch {
			try? await writer.write { db in try Self.finish(db, claimed.id, status: "error", reason: "\(error)") }
			return FlowRunner.Result(ok: false, error: "\(error)", outputs: [:], destinations: [])
		}
		let trigger = "\(claimed.event["type"]?.stringValue ?? ""):\(claimed.binding.trigger["id"]?.stringValue ?? "")"
		let result = await runner.run(claimed.binding.document, options: FlowRunner.Options(inputs: inputs, trigger: trigger))
		let cancelled = Task.isCancelled
		TobyLog.shared.write(result.ok ? "info" : "warn", category: "flows", type: result.ok ? "flow_run_complete" : "flow_run_failed",
		                     data: ["flow": .string(claimed.binding.flowID), "trigger": .string(trigger), "error": result.ok ? .null : .string(result.error ?? "")])
		try? await writer.write { db in
			try Self.finish(db, claimed.id, status: cancelled ? "interrupted" : result.ok ? "success" : "error", reason: result.ok ? nil : result.error, runID: result.runID, output: result.extracted?["text"]?.stringValue)
		}
		if claimed.binding.trigger["notifyOnCompletion"] == true, !cancelled, let events {
			await events.notifyCompletion(flowID: claimed.binding.flowID, runID: result.runID, name: claimed.binding.document["name"]?.stringValue ?? "Flow", success: result.ok)
		}
		return result
	}

	/// Run a flow now from a manual or Home trigger (`POST /api/flows/:id/run`).
	public func runNow(_ id: String, source: String, triggerID: String?) async throws -> RunOutcome {
		guard let record = try await writer.read({ db in try FlowDocuments.load(db, id) }) else { throw TodoError("not_found", "Flow not found", status: 404) }
		if record.builtin { throw TodoError("forbidden", "Built-in flows run through Home", status: 403) }
		guard Self.userInvoked(source) else { throw TodoError.invalid("Unsupported user-invoked trigger source") }
		let claimed = try await writer.write { db -> (id: String, binding: Binding, event: JSONValue)? in
			guard let binding = try Self.bindings(db).first(where: {
				$0.flowID == id && $0.trigger["source"]?["type"]?.stringValue == source && $0.trigger["enabled"] == true && (triggerID == nil || $0.trigger["id"]?.stringValue == triggerID)
			}) else {
				throw TodoError.invalid(source == "home.action" ? "Enable a Home Screen Action trigger to run this flow from Home" : "Enable a manual trigger to run this flow")
			}
			guard let decision = try Self.enqueue(db, binding, event: ["id": .string(UUID().uuidString.lowercased()), "type": .string(source), "occurredAt": .string(TodoRecurrence.isoString(Date())), "payload": [:]]) else {
				throw TodoError("conflict", "Could not claim flow", status: 409)
			}
			guard let claimed = try Self.claim(db, now: Date(), id: decision) else {
				try Self.finish(db, decision, status: "skipped", reason: "busy")
				throw TodoError("conflict", "Flow is busy; try again when the active run finishes", status: 409)
			}
			return claimed
		}
		guard let claimed else { throw TodoError("conflict", "Could not claim flow", status: 409) }
		let result = await work(claimed)
		var json: [String: JSONValue] = [
			"ok": .bool(result.ok), "runId": result.runID.map(JSONValue.string) ?? .null, "error": result.ok ? .null : .string(result.error ?? "Flow failed"),
			"failedNodeId": result.failedNodeID.map(JSONValue.string) ?? .null, "result": result.extracted ?? .null, "destinations": .array(result.destinations),
		]
		if result.insufficientCredits { json["code"] = "insufficient_credits"; json["providerId"] = "openrouter"; json["activity"] = "run a flow" }
		return RunOutcome(json: .object(json), insufficientCredits: result.insufficientCredits)
	}

	public func decisions(flowID: String?) throws -> JSONValue {
		["decisions": .array(try writer.read { db in
			try Row.fetchAll(db, sql: "SELECT * FROM flow_trigger_decisions WHERE (? IS NULL OR flow_id = ?) ORDER BY created_at DESC, rowid DESC LIMIT 100", arguments: [flowID, flowID]).map { row in
				["id": .string(row["id"]), "binding": FlowRunner.parse(row["binding_json"]), "event": FlowRunner.parse(row["event_json"]), "status": .string(row["status"]),
				 "reason": FlowRunner.optional(row["reason"] as String?), "flowRunId": FlowRunner.optional(row["flow_run_id"] as String?),
				 "output": FlowRunner.optional(row["output"] as String?), "createdAt": .string(row["created_at"])]
			}
		})]
	}

	// MARK: Supervisor

	/// Poll schedules and macOS events every 5s; run up to two decisions.
	public func runSupervisor() async {
		try? await writer.write { db in
			try db.execute(sql: "UPDATE flow_trigger_decisions SET status = 'interrupted', reason = 'Toby stopped; external effects may already have occurred' WHERE status IN ('pending','running')")
		}
		var failures = 0
		while !Task.isCancelled {
			do {
				try await writer.write { db in try Self.enqueueSchedules(db) }
				try await pollNativeEvents()
				failures = 0
			} catch {
				failures += 1
				sourceStatus = ["state": "waiting", "message": .string((error as? LocalizedError)?.errorDescription ?? "Waiting for macOS events"), "lastPollAt": sourceStatus["lastPollAt"] ?? .null]
			}
			while workers < 2 {
				guard let claimed = try? await writer.write({ db in try Self.claim(db, now: Date()) }) else { break }
				workers += 1
				Task { [self] in
					_ = await self.work(claimed)
					self.workerDone()
				}
			}
			try? await Task.sleep(for: .seconds(Double(min(15, 5 * max(1, failures)))))
		}
		if let events { _ = try? await events.subscribe(owner: owner, types: [], watches: []) }
		sourceStatus = ["state": "stopped", "message": "Toby stopped", "lastPollAt": sourceStatus["lastPollAt"] ?? .null]
	}

	func workerDone() { workers -= 1 }

	func pollNativeEvents() async throws {
		guard let events else { return }
		let bindings = try await writer.read { db in try Self.bindings(db) }.filter { $0.trigger["enabled"] == true && ($0.trigger["source"]?["type"]?.stringValue ?? "").hasPrefix("macos.") }
		let types = Array(Set(bindings.compactMap { $0.trigger["source"]?["type"]?.stringValue })).sorted()
		guard !types.isEmpty else {
			if !activeTypes.isEmpty { _ = try await events.subscribe(owner: owner, types: [], watches: []) }
			activeTypes = ""
			cursor = nil
			sourceStatus = ["state": "idle", "message": "No enabled macOS triggers", "lastPollAt": .null]
			return
		}
		let watches: [JSONValue] = bindings.filter { $0.trigger["source"]?["type"] == "macos.fileChanges" }.map { binding in
			var watch = binding.trigger["source"]?.objectValue ?? [:]
			watch["id"] = .string("\(binding.id):\(binding.revision)")
			watch.removeValue(forKey: "type")
			watch.removeValue(forKey: "runPerFile")
			return .object(watch)
		}
		let subscription = try await events.subscribe(owner: owner, types: types, watches: watches)
		let session = subscription["sessionId"]?.stringValue ?? ""
		if cursor == nil || cursor?.session != session || activeTypes != types.joined(separator: ",") { cursor = (session, subscription["sequence"]?.intValue ?? 0) }
		activeTypes = types.joined(separator: ",")
		let batch = try await events.events(session: session, after: cursor?.sequence ?? 0, limit: 100)
		let next = batch["sequence"]?.intValue ?? cursor?.sequence ?? 0
		if batch["gap"] != true {
			let list = batch["events"]?.arrayValue ?? []
			try await writer.write { db in
				let enabled = try Self.bindings(db).filter { $0.trigger["enabled"] == true }
				for event in list {
					for binding in enabled where binding.trigger["source"]?["type"] == event["type"] {
						if event["type"] == "macos.fileChanges" {
							guard event["payload"]?["watchId"]?.stringValue == "\(binding.id):\(binding.revision)" else { continue }
							if binding.trigger["source"]?["runPerFile"] == true {
								for (index, change) in (event["payload"]?["changes"]?.arrayValue ?? []).enumerated() {
									var payload = event["payload"]?.objectValue ?? [:]
									payload["changes"] = [change]
									var single = event.objectValue ?? [:]
									single["payload"] = .object(payload)
									try Self.enqueue(db, binding, event: .object(single), occurrence: "\(event["id"]?.stringValue ?? ""):file:\(index)")
								}
								continue
							}
						}
						try Self.enqueue(db, binding, event: event)
					}
				}
				try db.execute(sql: "INSERT INTO flow_trigger_cursor VALUES ('macos', ?, ?) ON CONFLICT(source) DO UPDATE SET session_id = excluded.session_id, sequence = excluded.sequence", arguments: [session, next])
			}
		}
		cursor = (session, next)
		let folderErrors = subscription["folderErrors"]?.objectValue ?? [:]
		let unavailable = !folderErrors.isEmpty || (subscription["idleAvailable"] == false && types.contains("macos.userReturned"))
		sourceStatus = [
			"state": .string(unavailable ? "unavailable" : "observing"),
			"message": .string(unavailable ? (folderErrors.values.first?.stringValue ?? "Idle input timing unavailable") : "Observing macOS events"),
			"lastPollAt": .string(TodoRecurrence.isoString(Date())),
		]
	}
}
