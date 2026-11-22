import Foundation
import TobyAI

/// Chat transcript entries (`{kind, …}` JSON, the app's `TranscriptEntry`
/// shape) and the event reducer that builds them (port of
/// `chat-pipeline/transcript-reducer.ts` and `transcript-persist.ts`).
public enum ChatTranscript {
	static let hiddenLifecycleHeaders: Set<String> = [
		"Sending request to model…", "Updating session messages…", "Saving session…", "Preparing Session…",
	]

	// MARK: Row encoding

	/// DB row (`kind`, `text`) for an entry: the entry's JSON minus `kind`, or
	/// plain text for simple user/assistant/meta/error rows.
	public static func row(_ entry: JSONValue) -> (kind: String, text: String) {
		let kind = entry["kind"]?.stringValue ?? "meta"
		var object = entry.objectValue ?? [:]
		object.removeValue(forKey: "kind")
		switch kind {
		case "user":
			let hasExtras = !(object["attachments"]?.arrayValue ?? []).isEmpty || object["createdAt"]?.stringValue != nil
			return (kind, hasExtras ? JSONValue.object(object).jsonString() : (object["text"]?.stringValue ?? ""))
		case "assistant":
			return (kind, object["createdAt"] != nil ? JSONValue.object(object).jsonString() : (object["text"]?.stringValue ?? ""))
		case "meta", "error":
			return (kind, object["text"]?.stringValue ?? "")
		default:
			return (kind, JSONValue.object(object).jsonString())
		}
	}

	/// Parse a stored row back into an entry (legacy plain-text rows included).
	public static func entry(kind: String, text: String) -> JSONValue {
		let parsed = (try? JSONValue(parsing: text))?.objectValue
		switch kind {
		case "user", "assistant":
			if var parsed, parsed["text"]?.stringValue != nil {
				parsed["kind"] = .string(kind)
				return .object(parsed)
			}
			return ["kind": .string(kind), "text": .string(text)]
		case "meta", "error":
			return ["kind": .string(kind), "text": .string(text)]
		case "boxed_step", "tool_call", "tool_output", "ask_user_qa", "notice", "turn_work":
			guard var parsed else { return ["kind": "meta", "text": .string(text)] }
			parsed["kind"] = .string(kind)
			return .object(parsed)
		default:
			return ["kind": "meta", "text": .string(text)]
		}
	}

	// MARK: Tool display

	/// One-line, display-safe summary of a tool result.
	public static func formatToolOutput(result: JSONValue, error: JSONValue?) -> String {
		func oneLine(_ text: String, _ max: Int = 200) -> String {
			let flat = text.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
			return flat.count > max ? String(flat.prefix(max - 1)) + "…" : flat
		}
		if let error, !error.isNull { return "Error: " + oneLine(error.stringValue ?? error.jsonString()) }
		if let message = result["error"]?.stringValue, !message.isEmpty { return "Error: " + oneLine(message) }
		if let text = result.stringValue { return text.isEmpty ? "Done." : oneLine(text) }
		for key in ["message", "summary", "title", "subject", "status"] {
			if let text = result[key]?.stringValue, !text.isEmpty { return oneLine(text) }
		}
		if let inner = result["result"], !inner.isNull { return formatToolOutput(result: inner, error: nil) }
		for key in ["todos", "items", "memories", "results", "files", "projects", "lists", "tags", "entries"] {
			if let items = result[key]?.arrayValue { return items.count == 1 ? "1 result" : "\(items.count) results" }
		}
		if let items = result.arrayValue { return items.count == 1 ? "1 result" : "\(items.count) results" }
		return "Done."
	}

	/// Display-safe args: scalars and string lists only, long strings clipped.
	public static func displayArgs(_ args: JSONValue) -> JSONValue {
		var out: [String: JSONValue] = [:]
		for (key, value) in args.objectValue ?? [:] {
			switch value {
			case let .string(text): out[key] = .string(text.count > 300 ? String(text.prefix(299)) + "…" : text)
			case .number, .bool: out[key] = value
			case let .array(items) where items.allSatisfy({ $0.stringValue != nil }): out[key] = .array(Array(items.prefix(20)))
			default: continue
			}
		}
		return .object(out)
	}

	static func argSummary(toolName: String, args: JSONValue) -> String {
		if toolName == "askUser" { return "" }
		for key in ["id", "messageId", "taskId", "userId"] {
			if let id = args[key]?.stringValue, !id.isEmpty {
				return " · " + (id.count > 28 ? String(id.prefix(25)) + "…" : id)
			}
		}
		let query = (args["query"]?.stringValue ?? args["q"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		if !query.isEmpty { return " · “" + (query.count > 36 ? String(query.prefix(33)) + "…" : query) + "”" }
		return ""
	}

	// MARK: Reducer

	/// Builds transcript entries from chat events during a turn.
	public struct Reducer: Sendable {
		public private(set) var entries: [JSONValue]
		var localSeq = 0
		var assistantHeader = ""
		var assistantBuffer = ""
		/// Tool name → display title.
		let titles: [String: String]

		public init(entries: [JSONValue] = [], titles: [String: String] = [:]) {
			self.entries = entries
			self.titles = titles
		}

		func header(_ toolName: String, _ args: JSONValue) -> String {
			(titles[toolName] ?? Self.humanize(toolName)) + ChatTranscript.argSummary(toolName: toolName, args: args)
		}

		func groupedHeader(_ toolName: String, count: Int) -> String {
			"\(titles[toolName] ?? Self.humanize(toolName)) (x\(count))"
		}

		/// `createTobyTodo` → "Create toby todo".
		static func humanize(_ name: String) -> String {
			var words: [String] = []
			var current = ""
			for character in name {
				if character.isUppercase, !current.isEmpty { words.append(current); current = "" }
				if character == "_" { if !current.isEmpty { words.append(current) }; current = ""; continue }
				current.append(character)
			}
			if !current.isEmpty { words.append(current) }
			let sentence = words.map { $0.lowercased() }.joined(separator: " ")
			return sentence.prefix(1).uppercased() + sentence.dropFirst()
		}

		public mutating func addUser(_ text: String, attachments: [JSONValue] = [], createdAt: String) {
			var entry: [String: JSONValue] = ["kind": "user", "text": .string(text), "createdAt": .string(createdAt)]
			if !attachments.isEmpty { entry["attachments"] = .array(attachments) }
			entries.append(.object(entry))
		}

		public mutating func addNotice(_ text: String, tone: String? = nil) {
			var entry: [String: JSONValue] = ["kind": "notice", "text": .string(text)]
			if let tone { entry["tone"] = .string(tone) }
			entries.append(.object(entry))
		}

		public mutating func addError(_ text: String) {
			entries.append(["kind": "error", "text": .string(text)])
		}

		public mutating func addTurnWork(durationMs: Int) {
			entries.append(["kind": "turn_work", "durationMs": .number(Double(durationMs))])
		}

		func lastIndex(where predicate: (JSONValue) -> Bool) -> Int? {
			entries.lastIndex(where: predicate)
		}

		func toolIndex(_ blockKey: String) -> Int? {
			lastIndex { entry in
				entry["kind"] == "boxed_step" && entry["variant"] == "tool" &&
					(entry["toolBlockKey"]?.stringValue == blockKey || (entry["toolRuns"]?.arrayValue ?? []).contains { $0["blockKey"]?.stringValue == blockKey })
			}
		}

		static func runs(_ entry: JSONValue) -> [JSONValue] {
			if let runs = entry["toolRuns"]?.arrayValue, !runs.isEmpty { return runs }
			var run: [String: JSONValue] = [
				"blockKey": entry["toolBlockKey"] ?? entry["id"] ?? .null,
				"header": entry["header"] ?? "", "body": entry["body"] ?? "",
			]
			for key in ["fullBody", "cacheHit", "durationMs", "args", "failed"] { if let value = entry[key] { run[key] = value } }
			return [.object(run)]
		}

		/// Apply one chat event (`type` + fields).
		public mutating func apply(_ event: JSONValue) {
			let type = event["type"]?.stringValue ?? ""
			switch type {
			case "assistant_segment_start":
				assistantHeader = event["header"]?.stringValue ?? ""
				assistantBuffer = ""
			case "assistant_text_delta":
				assistantBuffer += event["delta"]?.stringValue ?? ""
			case "assistant_segment_end":
				let body = assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
				assistantBuffer = ""
				guard !body.isEmpty else { return }
				localSeq += 1
				entries.append([
					"kind": "boxed_step", "id": event["id"] ?? .string(UUID().uuidString), "seq": .number(Double(localSeq)),
					"variant": .string(event["interim"] == true ? "assistant_interim" : "assistant"),
					"header": .string(assistantHeader), "body": .string(body), "createdAt": .string(TodoRecurrence.isoString(Date())),
				])
			case "lifecycle_start":
				let header = event["header"]?.stringValue ?? ""
				guard !hiddenLifecycleHeaders.contains(header) else { return }
				entries.append(["kind": "boxed_step", "id": event["id"] ?? .null, "seq": event["seq"] ?? 0, "variant": "lifecycle", "header": .string(header), "body": ""])
			case "transcript_notice":
				addNotice(event["text"]?.stringValue ?? "", tone: event["tone"]?.stringValue)
			case "tool_call_start":
				toolStart(event)
			case "tool_call_complete":
				toolComplete(event)
			default:
				return
			}
		}

		mutating func toolStart(_ event: JSONValue) {
			let toolName = event["toolName"]?.stringValue ?? ""
			guard toolName != "askUser", let blockKey = event["blockKey"]?.stringValue else { return }
			let args = event["args"] ?? .object([:])
			if let index = toolIndex(blockKey) {
				patch(index, blockKey: blockKey, fields: ["args": displayArgs(args)], header: header(toolName, args))
				return
			}
			if let last = entries.last, last["kind"] == "boxed_step", last["variant"] == "tool", last["toolName"]?.stringValue == toolName {
				var runs = Self.runs(last)
				runs.append(["blockKey": .string(blockKey), "header": .string(header(toolName, args)), "body": "", "args": displayArgs(args)])
				var object = last.objectValue ?? [:]
				object["seq"] = event["seq"] ?? 0
				object["header"] = .string(groupedHeader(toolName, count: runs.count))
				object["body"] = ""
				object["toolRuns"] = .array(runs)
				object.removeValue(forKey: "cacheHit")
				entries[entries.count - 1] = .object(object)
				return
			}
			entries.append([
				"kind": "boxed_step", "id": .string(blockKey), "seq": event["seq"] ?? 0, "variant": "tool",
				"header": .string(header(toolName, args)), "body": "", "toolBlockKey": .string(blockKey), "toolName": .string(toolName),
				"args": displayArgs(args),
			])
		}

		mutating func toolComplete(_ event: JSONValue) {
			let toolName = event["toolName"]?.stringValue ?? ""
			let args = event["args"] ?? .object([:])
			let result = event["result"] ?? .null
			let error = event["error"]
			guard let blockKey = event["blockKey"]?.stringValue else { return }
			if toolName == "askUser" {
				var entry: [String: JSONValue] = ["kind": "ask_user_qa", "blockKey": .string(blockKey), "query": args["query"] ?? "", "answer": ""]
				if let error, !error.isNull {
					entry["error"] = .string(error.stringValue ?? error.jsonString())
				} else if let message = result["error"]?.stringValue {
					entry["error"] = .string(message)
				} else {
					entry["answer"] = .string((result["selectedLabel"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces))
				}
				entries.append(.object(entry))
				return
			}
			let detail = event["summary"]?.stringValue ?? formatToolOutput(result: result, error: error)
			let failed = (error.map { !$0.isNull } ?? false) || !(result["error"]?.stringValue ?? "").isEmpty
			var fields: [String: JSONValue] = ["body": .string(detail), "args": displayArgs(args), "failed": .bool(failed)]
			if let duration = event["durationMs"] { fields["durationMs"] = duration }
			if let cacheHit = event["cacheHit"] { fields["cacheHit"] = cacheHit }
			if let index = toolIndex(blockKey) {
				patch(index, blockKey: blockKey, fields: fields, header: nil)
				var object = entries[index].objectValue ?? [:]
				object["seq"] = event["seq"] ?? 0
				entries[index] = .object(object)
				return
			}
			var entry: [String: JSONValue] = [
				"kind": "boxed_step", "id": .string(blockKey), "seq": event["seq"] ?? 0, "variant": "tool",
				"header": .string(header(toolName, args)), "toolBlockKey": .string(blockKey), "toolName": .string(toolName),
			]
			entry.merge(fields) { _, new in new }
			entries.append(.object(entry))
		}

		mutating func patch(_ index: Int, blockKey: String, fields: [String: JSONValue], header: String?) {
			guard var object = entries[index].objectValue else { return }
			if var runs = object["toolRuns"]?.arrayValue, !runs.isEmpty {
				guard let runIndex = runs.firstIndex(where: { $0["blockKey"]?.stringValue == blockKey }), var run = runs[runIndex].objectValue else { return }
				run.merge(fields) { _, new in new }
				if let header { run["header"] = .string(header) }
				runs[runIndex] = .object(run)
				object["toolRuns"] = .array(runs)
				if runs.count == 1 { object.merge(fields) { _, new in new } }
			} else {
				object.merge(fields) { _, new in new }
				if let header { object["header"] = .string(header) }
			}
			entries[index] = .object(object)
		}
	}
}
