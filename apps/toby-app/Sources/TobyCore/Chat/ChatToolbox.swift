import Foundation
import PDFKit
import TobyAI

/// Per-turn context handed to tools.
public struct ChatToolContext: Sendable {
	public var sessionID: String
	public var project: ProjectService.Project?
	public var dryRun: Bool
	/// Ask the user a multiple-choice question; returns the chosen option.
	public var askUser: @Sendable (_ query: String, _ options: [String]) async throws -> (index: Int, label: String, rawInput: String)
	/// Current location (CoreLocation lives in the app).
	public var location: (@Sendable () async throws -> JSONValue)?

	public init(
		sessionID: String,
		project: ProjectService.Project? = nil,
		dryRun: Bool = false,
		askUser: @escaping @Sendable (String, [String]) async throws -> (index: Int, label: String, rawInput: String),
		location: (@Sendable () async throws -> JSONValue)? = nil,
	) {
		self.sessionID = sessionID
		self.project = project
		self.dryRun = dryRun
		self.askUser = askUser
		self.location = location
	}
}

/// A tool plus its display title and mutation flag (for "applied actions").
public struct ChatTool: Sendable {
	public var tool: Tool
	public var title: String
	public var readOnly: Bool
}

/// Small JSON Schema helpers for tool parameters (non-strict: optional
/// properties are simply not listed in `required`).
enum ToolSchema {
	static func object(_ properties: [(String, JSONValue)], required: [String] = []) -> JSONSchema {
		JSONSchema([
			"type": "object",
			"properties": .object(Dictionary(properties, uniquingKeysWith: { a, _ in a })),
			"required": .array(required.map(JSONValue.string)),
		])
	}

	static func string(_ description: String, enum values: [String]? = nil) -> JSONValue {
		var object: [String: JSONValue] = ["type": "string", "description": .string(description)]
		if let values { object["enum"] = .array(values.map(JSONValue.string)) }
		return .object(object)
	}

	static func integer(_ description: String) -> JSONValue { ["type": "integer", "description": .string(description)] }
	static func number(_ description: String) -> JSONValue { ["type": "number", "description": .string(description)] }
	static func boolean(_ description: String) -> JSONValue { ["type": "boolean", "description": .string(description)] }
	static func array(_ items: JSONValue, _ description: String) -> JSONValue { ["type": "array", "items": items, "description": .string(description)] }

	static let due: JSONValue = [
		"type": "object",
		"description": "Due date. time is HH:mm (24h) or null for date-only; timezone is an IANA id.",
		"properties": ["date": ["type": "string", "description": "YYYY-MM-DD"], "time": ["type": ["string", "null"]], "timezone": ["type": "string"]],
		"required": ["date"],
	]
	static let recurrence: JSONValue = [
		"type": "object",
		"properties": [
			"mode": ["type": "string", "enum": ["calendar", "completion"]],
			"unit": ["type": "string", "enum": ["day", "week", "month", "year"]],
			"interval": ["type": "integer"],
			"weekdays": ["type": "array", "items": ["type": "integer"], "description": "0=Sunday; weekly calendar mode only"],
			"endDate": ["type": ["string", "null"]],
		],
		"required": ["mode", "unit"],
	]
	static var todoFields: [(String, JSONValue)] {
		[
			("title", string("Todo title")),
			("description", string("Notes")),
			("priority", string("Priority", enum: ["none", "low", "medium", "high"])),
			("listId", string("List id (default inbox)")),
			("projectId", ["type": ["string", "null"], "description": "Linked Toby project id"]),
			("projectLabel", ["type": ["string", "null"]]),
			("recurrence", ["anyOf": [recurrence, ["type": "null"]]]),
		]
	}

	/// Drop top-level nulls (models send `null` for omitted optional args).
	static func stripNulls(_ value: JSONValue, keep: Set<String> = []) -> JSONValue {
		guard case let .object(object) = value else { return value }
		return .object(object.filter { !$0.value.isNull || keep.contains($0.key) })
	}
}

/// Toby's built-in chat tools (ports of `core-tools`, `memory/tools.ts`,
/// `library/tools.ts`, `ai/global-chat-tools.ts`, web/weather tools).
public final class ChatToolbox: Sendable {
	public let todos: TodoActions
	public let memory: MemoryService
	public let graph: GraphService
	public let library: LibraryService
	public let projects: ProjectService
	public let skills: SkillService
	let tobyDirectory: URL
	let ai: OpenRouterClient?
	let transport: any HTTPTransport

	public init(todos: TodoActions, memory: MemoryService, graph: GraphService, library: LibraryService, projects: ProjectService, skills: SkillService, tobyDirectory: URL, ai: OpenRouterClient?, transport: any HTTPTransport = URLSessionTransport()) {
		self.todos = todos
		self.memory = memory
		self.graph = graph
		self.library = library
		self.projects = projects
		self.skills = skills
		self.tobyDirectory = tobyDirectory
		self.ai = ai
		self.transport = transport
	}

	/// All tools for a turn.
	public func tools(_ context: ChatToolContext) -> [ChatTool] {
		var tools: [ChatTool] = [askUser(context), dateTime()]
		tools += todoTools(context)
		tools += memoryTools(context)
		tools += libraryTools(context)
		tools += projectTools(context)
		tools += skillTools(context)
		tools += webTools(context)
		tools.append(graphNeighbors())
		if context.location != nil { tools.append(myLocation(context)) }
		return tools
	}

	static func ok(_ result: JSONValue) -> JSONValue { ["ok": true, "provider": "toby", "result": result] }

	static func failure(_ error: Error) -> JSONValue {
		let code = (error as? TodoError)?.code ?? "invalid_input"
		return ["ok": false, "code": .string(code), "error": .string((error as? LocalizedError)?.errorDescription ?? String(describing: error))]
	}

	// MARK: askUser / time

	func askUser(_ context: ChatToolContext) -> ChatTool {
		ChatTool(tool: Tool(
			name: "askUser",
			description: "Ask the user a multiple-choice question and wait for their answer. Use whenever you need a decision; plain text questions get no reply.",
			parameters: ToolSchema.object([
				("query", ToolSchema.string("The question")),
				("options", ToolSchema.array(["type": "string"], "2–6 short answer options")),
			], required: ["query", "options"]),
			readOnly: true,
		) { args, _ in
			let options = (args["options"]?.arrayValue ?? []).compactMap(\.stringValue)
			do {
				let answer = try await context.askUser(args["query"]?.stringValue ?? "", options)
				return ["selectedIndex": .number(Double(answer.index)), "selectedLabel": .string(answer.label), "rawInput": .string(answer.rawInput)]
			} catch {
				return ["error": .string(error.localizedDescription)]
			}
		}, title: "Ask", readOnly: true)
	}

	func dateTime() -> ChatTool {
		ChatTool(tool: Tool(name: "getCurrentDateTime", description: "The current local date, time, and timezone.", readOnly: true) { _, _ in
			let now = Date()
			let formatter = DateFormatter()
			formatter.dateFormat = "EEEE, MMMM d, yyyy 'at' h:mm a"
			return ["iso": .string(TodoRecurrence.isoString(now)), "local": .string(formatter.string(from: now)), "timezone": .string(TimeZone.current.identifier)]
		}, title: "Current date and time", readOnly: true)
	}

	// MARK: Todos

	func todoTools(_ context: ChatToolContext) -> [ChatTool] {
		let target = ("id", ToolSchema.string("Todo id"))
		let sequence = ("sequence", ToolSchema.integer("Occurrence sequence returned by get/list"))
		let suffix = " in Toby's internal todo system. Use by default for todo requests."
		let definitions: [(String, String, String, Bool, JSONSchema, String)] = [
			("list", "listTobyTodos", "Find todos", true, ToolSchema.object([
				("query", ToolSchema.string("Text search")), ("status", ToolSchema.string("Status", enum: ["open", "completed", "all", "deleted"])),
				("listId", ToolSchema.string("List id")), ("projectId", ToolSchema.string("Project id")), ("tagId", ToolSchema.string("Tag id")),
				("priority", ToolSchema.string("Priority", enum: ["none", "low", "medium", "high"])),
				("dueFrom", ToolSchema.string("YYYY-MM-DD")), ("dueTo", ToolSchema.string("YYYY-MM-DD")),
				("limit", ToolSchema.integer("1–200")), ("offset", ToolSchema.integer("Offset")),
			]), ""),
			("get", "getTobyTodo", "Get todo", true, ToolSchema.object([target, sequence], required: ["id"]), ""),
			("create", "createTobyTodo", "Create todo", false, ToolSchema.object(ToolSchema.todoFields + [
				("due", ["anyOf": [ToolSchema.due, ["type": "null"]]]),
				("tags", ToolSchema.array(["type": "string"], "Tag ids")),
				("checklist", ToolSchema.array(["type": "string"], "Checklist item texts")),
				("remind", ToolSchema.boolean("Remind at the due time (needs a due time)")),
			], required: ["title"]), " When the user asks to be reminded, set remind: true; it requires a due date with a time."),
			("update", "updateTobyTodo", "Update todo", false, ToolSchema.object([
				target,
				("changes", ["type": "object", "description": "Fields to change; null clears an optional field. scope=series edits future occurrences.",
				             "properties": .object(Dictionary((ToolSchema.todoFields + [("due", ["anyOf": [ToolSchema.due, ["type": "null"]]]), ("scope", ToolSchema.string("Scope", enum: ["occurrence", "series"]))]), uniquingKeysWith: { a, _ in a }))]),
			], required: ["id", "changes"]), ""),
			("complete", "completeTobyTodo", "Complete todo", false, ToolSchema.object([target, sequence, ("allowIncompleteChecklist", ToolSchema.boolean("Complete even with unchecked items"))], required: ["id", "sequence"]), ""),
			("skip", "skipTobyTodo", "Skip todo", false, ToolSchema.object([target, sequence], required: ["id", "sequence"]), ""),
			("reopen", "reopenTobyTodo", "Reopen todo", false, ToolSchema.object([target, sequence], required: ["id", "sequence"]), ""),
			("delete", "deleteTobyTodo", "Delete todo", false, ToolSchema.object([target], required: ["id"]), ""),
			("restore", "restoreTobyTodo", "Restore deleted todo", false, ToolSchema.object([target], required: ["id"]), ""),
			("setTag", "setTobyTodoTag", "Assign or remove todo tag", false, ToolSchema.object([target, ("tagId", ToolSchema.string("Tag id")), ("enabled", ToolSchema.boolean("Assign (true) or remove"))], required: ["id", "tagId", "enabled"]), ""),
			("setChecklistItem", "setTobyTodoChecklistItem", "Set checklist item", false, ToolSchema.object([
				target, ("item", ["type": "object", "properties": ["id": ["type": "string"], "text": ["type": "string"], "order": ["type": "number"], "checked": ["type": "boolean"]], "required": ["id", "text", "order"]]),
				("remove", ToolSchema.boolean("Remove the item")),
			], required: ["id", "item"]), ""),
			("setReminder", "setTobyTodoReminder", "Set or snooze todo reminder", false, ToolSchema.object([
				target, ("reminder", ["type": "object", "properties": ["id": ["type": "string"], "at": ["type": ["string", "null"]], "offsetMinutes": ["type": ["integer", "null"]], "snoozedUntil": ["type": ["string", "null"]]], "required": ["id"]]),
				("remove", ToolSchema.boolean("Remove the reminder")),
			], required: ["id", "reminder"]), " Use id \"due\" with offsetMinutes 0 to remind at the due time; date-only todos need an absolute \"at\"."),
			("lists", "listTobyTodoLists", "List todo lists", true, ToolSchema.object([]), ""),
			("saveLists", "saveTobyTodoList", "Create, rename, or remove todo list", false, ToolSchema.object([("id", ToolSchema.string("List id (omit to create)")), ("name", ToolSchema.string("Name")), ("remove", ToolSchema.boolean("Remove"))]), ""),
			("tags", "listTobyTodoTags", "List todo tags", true, ToolSchema.object([]), ""),
			("saveTags", "saveTobyTodoTag", "Create, rename, or remove todo tag", false, ToolSchema.object([("id", ToolSchema.string("Tag id (omit to create)")), ("name", ToolSchema.string("Name")), ("remove", ToolSchema.boolean("Remove"))]), ""),
			("history", "getTobyTodoHistory", "Read todo history", true, ToolSchema.object([target], required: ["id"]), ""),
			("restoreField", "restoreTobyTodoField", "Restore todo field from history", false, ToolSchema.object([target, ("operationId", ToolSchema.string("History operation id")), ("field", ToolSchema.string("Field name"))], required: ["id", "operationId", "field"]), ""),
			("summary", "getTobyTodosSummary", "Summarize open todos", true, ToolSchema.object([]), ""),
		]
		let actions = todos
		return definitions.map { action, name, title, readOnly, schema, detail in
			ChatTool(tool: Tool(name: name, description: "\(title)\(suffix)\(detail)", parameters: schema, readOnly: readOnly) { raw, _ in
				do {
					let args = ToolSchema.stripNulls(raw)
					let result = try actions.execute(action, input: args, context: TodoMutationContext(source: "chat", dryRun: context.dryRun))
					return Self.ok(result)
				} catch {
					return Self.failure(error)
				}
			}, title: title, readOnly: readOnly)
		}
	}

	// MARK: Memory

	func memoryTools(_ context: ChatToolContext) -> [ChatTool] {
		let memory = memory
		let dry = context.dryRun
		return [
			ChatTool(tool: Tool(name: "memorySearch", description: "Search the user's saved memories (semantic and keyword).", parameters: ToolSchema.object([("query", ToolSchema.string("Natural-language phrase or keywords"))], required: ["query"]), readOnly: true) { args, _ in
				let results = try await memory.search(args["query"]?.stringValue ?? "")
				return ["memories": .array(Array(results.prefix(25)))]
			}, title: "Search memory", readOnly: true),
			ChatTool(tool: Tool(name: "memoryPropose", description: "Propose a durable memory (preference, fact, relationship…). Returns accepted or pending.", parameters: ToolSchema.object([
				("type", ToolSchema.string("Category", enum: MemoryText.types)), ("value", ToolSchema.string("The memory content")),
				("subject", ToolSchema.string("Optional subject")), ("confidence", ToolSchema.number("0–1 confidence")),
				("sourceSystem", ToolSchema.string("Where it came from", enum: ["email", "calendar", "drive", "chat", "manual", "other"])),
				("excerpt", ToolSchema.string("Supporting excerpt")), ("reason", ToolSchema.string("Why it is worth remembering")),
			], required: ["type", "value"])) { args, _ in
				if dry { return ["dryRun": true, "message": "Would propose a memory"] }
				return try await memory.propose(
					.init(type: args["type"]?.stringValue ?? "fact", subject: args["subject"]?.stringValue, value: args["value"]?.stringValue ?? "", confidence: args["confidence"]?.doubleValue ?? 0.8),
					system: args["sourceSystem"]?.stringValue ?? "chat", excerpt: args["excerpt"]?.stringValue, reason: args["reason"]?.stringValue ?? "Shared in chat",
				)
			}, title: "Remember", readOnly: false),
			ChatTool(tool: Tool(name: "memorySave", description: "Save a pending memory proposal.", parameters: ToolSchema.object([("proposalId", ToolSchema.string("Pending proposal id"))], required: ["proposalId"])) { args, _ in
				if dry { return ["dryRun": true] }
				do { return ["ok": true, "memory": try await memory.save(proposalID: args["proposalId"]?.stringValue ?? "")] } catch { return Self.failure(error) }
			}, title: "Save memory", readOnly: false),
			ChatTool(tool: Tool(name: "memoryForget", description: "Delete a memory.", parameters: ToolSchema.object([("memoryId", ToolSchema.string("Memory id"))], required: ["memoryId"])) { args, _ in
				if dry { return ["dryRun": true] }
				do {
					try memory.forget(args["memoryId"]?.stringValue ?? "")
					return ["ok": true, "message": .string("Forgot memory \(args["memoryId"]?.stringValue ?? "")")]
				} catch { return Self.failure(error) }
			}, title: "Forget memory", readOnly: false),
			ChatTool(tool: Tool(name: "memoryExplain", description: "Explain where a memory came from.", parameters: ToolSchema.object([("memoryId", ToolSchema.string("Memory id"))], required: ["memoryId"]), readOnly: true) { args, _ in
				try memory.explain(args["memoryId"]?.stringValue ?? "") ?? ["error": "Memory not found"]
			}, title: "Explain memory", readOnly: true),
			ChatTool(tool: Tool(name: "memoryRetrieveForTask", description: "Find memories relevant to a task.", parameters: ToolSchema.object([
				("taskDescription", ToolSchema.string("The task")), ("includeUnconfirmed", ToolSchema.boolean("Include memories needing confirmation")),
			], required: ["taskDescription"]), readOnly: true) { args, _ in
				try await memory.retrieve(for: args["taskDescription"]?.stringValue ?? "", includeUnconfirmed: args["includeUnconfirmed"]?.boolValue ?? false)
			}, title: "Recall memories", readOnly: true),
		]
	}

	// MARK: Library

	func libraryTools(_ context: ChatToolContext) -> [ChatTool] {
		let library = library
		let dry = context.dryRun
		return [
			ChatTool(tool: Tool(name: "add_to_library", description: "Save text (e.g. notes, a draft) into the user's document library.", parameters: ToolSchema.object([
				("filename", ToolSchema.string("File name, e.g. notes.md")), ("content", ToolSchema.string("Text content")),
			], required: ["filename", "content"])) { args, _ in
				if dry { return ["dryRun": true] }
				var name = args["filename"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "note.md"
				if (name as NSString).pathExtension.isEmpty { name += ".md" }
				do {
					let result = try await library.add(filename: name, bytes: Data((args["content"]?.stringValue ?? "").utf8), source: "tool", reference: ["kind": "chat", "sessionId": .string(context.sessionID), "label": "Chat", "detail": .string(name)])
					return ["item": result.item, "duplicate": .bool(result.duplicate)]
				} catch { return Self.failure(error) }
			}, title: "Add to library", readOnly: false),
			ChatTool(tool: Tool(name: "find_in_library", description: "Search the user's document library (titles, summaries, and file text). Use includeText to read a match.", parameters: ToolSchema.object([
				("query", ToolSchema.string("What to look for")), ("id", ToolSchema.string("Open one item by id")), ("includeText", ToolSchema.boolean("Include extracted text (first 12k chars)")),
			]), readOnly: true) { args, _ in
				if let id = args["id"]?.stringValue {
					do {
						let opened = try library.open(id)
						return ["item": opened.item, "text": .string(String((opened.extractedText ?? "").prefix(12_000)))]
					} catch { return Self.failure(error) }
				}
				let results = Array(try await library.search(args["query"]?.stringValue ?? "").prefix(10))
				guard args["includeText"] == true else { return ["items": .array(results)] }
				return ["items": .array(results.map { item in
					var object = item.objectValue ?? [:]
					if let id = item["id"]?.stringValue, let text = try? library.open(id).extractedText { object["text"] = .string(String(text.prefix(4000))) }
					return .object(object)
				})]
			}, title: "Search library", readOnly: true),
			ChatTool(tool: Tool(name: "update_in_library", description: "Rename or re-describe a library item.", parameters: ToolSchema.object([
				("id", ToolSchema.string("Item id")), ("title", ToolSchema.string("New title")), ("description", ToolSchema.string("New description")),
			], required: ["id"])) { args, _ in
				if dry { return ["dryRun": true] }
				do { return ["item": try await library.update(args["id"]?.stringValue ?? "", title: args["title"]?.stringValue, description: args["description"]?.stringValue)] } catch { return Self.failure(error) }
			}, title: "Update library item", readOnly: false),
			ChatTool(tool: Tool(name: "remove_from_library", description: "Delete a library item.", parameters: ToolSchema.object([("id", ToolSchema.string("Item id"))], required: ["id"])) { args, _ in
				if dry { return ["dryRun": true] }
				return ["ok": .bool(try library.remove(args["id"]?.stringValue ?? ""))]
			}, title: "Remove from library", readOnly: false),
		]
	}

	// MARK: Projects & files

	/// Resolve a project-relative path, refusing escapes and symlinks.
	static func projectPath(_ project: ProjectService.Project, _ relative: String) throws -> URL {
		let root = URL(fileURLWithPath: project.folderPath).standardizedFileURL
		let cleaned = relative.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\\", with: "/")
		let url = root.appending(path: cleaned.hasPrefix("/") ? String(cleaned.drop { $0 == "/" }) : cleaned).standardizedFileURL
		guard url.path == root.path || url.path.hasPrefix(root.path + "/") else { throw ToolError("Paths must stay inside the project folder.") }
		var current = root
		for component in url.path.dropFirst(root.path.count).split(separator: "/") {
			current = current.appending(path: String(component))
			if (try? FileManager.default.attributesOfItem(atPath: current.path))?[.type] as? FileAttributeType == .typeSymbolicLink {
				throw ToolError("Project paths must not contain symbolic links.")
			}
		}
		return url
	}

	func projectTools(_ context: ChatToolContext) -> [ChatTool] {
		let projects = projects
		let dry = context.dryRun
		var tools: [ChatTool] = [
			ChatTool(tool: Tool(name: "listTobyProjects", description: "List Toby projects.", readOnly: true) { _, _ in
				["projects": .array(try projects.list().map(\.json))]
			}, title: "List projects", readOnly: true),
			ChatTool(tool: Tool(name: "createTobyProject", description: "Create a Toby project (a folder with instructions, outputs, and linked chats/todos).", parameters: ToolSchema.object([
				("name", ToolSchema.string("Project name")), ("summary", ToolSchema.string("What the project is about")),
			], required: ["name"])) { args, _ in
				if dry { return ["dryRun": true] }
				return ["project": try projects.create(name: args["name"]?.stringValue, summary: args["summary"]?.stringValue).json]
			}, title: "Create project", readOnly: false),
		]
		let generated = tobyDirectory.appending(path: "generated-files", directoryHint: .isDirectory)
		tools.append(ChatTool(tool: Tool(name: "writeTextFile", description: context.project == nil
			? "Write a text file (Markdown, CSV, code…) to Toby's generated files folder."
			: "Write a text file in the project. location=outputs for finished artifacts, location=context for notes in the project folder.",
			parameters: ToolSchema.object([
				("filename", ToolSchema.string("File name or project-relative path")), ("content", ToolSchema.string("Text content")),
				("location", ToolSchema.string("Where to write (projects only)", enum: ["outputs", "context"])), ("overwrite", ToolSchema.boolean("Replace an existing file")),
			], required: ["filename", "content"])) { args, _ in
			if dry { return ["dryRun": true] }
			let filename = args["filename"]?.stringValue ?? "untitled.md"
			let url: URL
			if let project = context.project {
				let base = args["location"]?.stringValue == "context" ? "" : "outputs/"
				url = try Self.projectPath(project, base + filename)
			} else {
				try FileManager.default.createDirectory(at: generated, withIntermediateDirectories: true)
				url = generated.appending(path: (filename as NSString).lastPathComponent)
			}
			if FileManager.default.fileExists(atPath: url.path), args["overwrite"] != true {
				throw ToolError("\(url.lastPathComponent) already exists. Pass overwrite: true to replace it.")
			}
			try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
			try (args["content"]?.stringValue ?? "").write(to: url, atomically: true, encoding: .utf8)
			return ["ok": true, "path": .string(url.path)]
		}, title: "Write file", readOnly: false))

		guard let project = context.project else { return tools }
		let root = URL(fileURLWithPath: project.folderPath)
		tools += [
			ChatTool(tool: Tool(name: "listProjectFiles", description: "List files in the active project folder.", readOnly: true) { _, _ in
				["files": .array(LibraryService.listFiles(root).prefix(500).map(JSONValue.string))]
			}, title: "List project files", readOnly: true),
			ChatTool(tool: Tool(name: "searchProjectFiles", description: "Search project file names and text contents.", parameters: ToolSchema.object([("query", ToolSchema.string("Words to find"))], required: ["query"]), readOnly: true) { args, _ in
				let needle = (args["query"]?.stringValue ?? "").lowercased()
				var hits: [JSONValue] = []
				for path in LibraryService.listFiles(root) where hits.count < 50 {
					let url = root.appending(path: path)
					if path.lowercased().contains(needle) { hits.append(["path": .string(path), "match": "name"]); continue }
					guard let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber, size.intValue < 1_000_000,
					      let text = try? String(contentsOf: url, encoding: .utf8), let range = text.lowercased().range(of: needle) else { continue }
					let lower = text.index(range.lowerBound, offsetBy: -80, limitedBy: text.startIndex) ?? text.startIndex
					let upper = text.index(range.upperBound, offsetBy: 80, limitedBy: text.endIndex) ?? text.endIndex
					hits.append(["path": .string(path), "match": "content", "excerpt": .string(String(text[lower ..< upper]))])
				}
				return ["results": .array(hits)]
			}, title: "Search project files", readOnly: true),
			ChatTool(tool: Tool(name: "readProjectFile", description: "Read a text file from the project (PDFs: use readPdf with path).", parameters: ToolSchema.object([("path", ToolSchema.string("Project-relative path"))], required: ["path"]), readOnly: true) { args, _ in
				let url = try Self.projectPath(project, args["path"]?.stringValue ?? "")
				let text = try String(contentsOf: url, encoding: .utf8)
				return ["path": args["path"] ?? .null, "content": .string(String(text.prefix(60_000))), "truncated": .bool(text.count > 60_000)]
			}, title: "Read project file", readOnly: true),
			ChatTool(tool: Tool(name: "createProjectFolder", description: "Create a folder in the project.", parameters: ToolSchema.object([("path", ToolSchema.string("Project-relative folder path"))], required: ["path"])) { args, _ in
				if dry { return ["dryRun": true] }
				try FileManager.default.createDirectory(at: try Self.projectPath(project, args["path"]?.stringValue ?? ""), withIntermediateDirectories: true)
				return ["ok": true]
			}, title: "Create folder", readOnly: false),
			ChatTool(tool: Tool(name: "renameProjectFile", description: "Move or rename a project file or folder.", parameters: ToolSchema.object([("from", ToolSchema.string("Current path")), ("to", ToolSchema.string("New path"))], required: ["from", "to"])) { args, _ in
				if dry { return ["dryRun": true] }
				let destination = try Self.projectPath(project, args["to"]?.stringValue ?? "")
				try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
				try FileManager.default.moveItem(at: try Self.projectPath(project, args["from"]?.stringValue ?? ""), to: destination)
				return ["ok": true]
			}, title: "Move file", readOnly: false),
			ChatTool(tool: Tool(name: "deleteProjectFile", description: "Delete a project file (only when the user asked).", parameters: ToolSchema.object([("path", ToolSchema.string("Project-relative path"))], required: ["path"])) { args, _ in
				if dry { return ["dryRun": true] }
				let url = try Self.projectPath(project, args["path"]?.stringValue ?? "")
				guard (try FileManager.default.attributesOfItem(atPath: url.path))[.type] as? FileAttributeType == .typeRegular else { throw ToolError("Not a file.") }
				try FileManager.default.removeItem(at: url)
				return ["ok": true]
			}, title: "Delete file", readOnly: false),
			ChatTool(tool: Tool(name: "deleteProjectFolder", description: "Delete an empty project folder (only when the user asked).", parameters: ToolSchema.object([("path", ToolSchema.string("Project-relative folder"))], required: ["path"])) { args, _ in
				if dry { return ["dryRun": true] }
				let url = try Self.projectPath(project, args["path"]?.stringValue ?? "")
				guard url.path != root.standardizedFileURL.path, (try FileManager.default.contentsOfDirectory(atPath: url.path)).isEmpty else { throw ToolError("Only empty folders inside the project can be deleted.") }
				try FileManager.default.removeItem(at: url)
				return ["ok": true]
			}, title: "Delete folder", readOnly: false),
		]
		return tools
	}

	// MARK: Skills

	func skillTools(_ context: ChatToolContext) -> [ChatTool] {
		let skills = skills
		let project = context.project
		let dry = context.dryRun
		return [
			ChatTool(tool: Tool(name: "loadLocalSkillInstructions", description: "Load a skill's full instructions by name (see the skills catalog).", parameters: ToolSchema.object([("name", ToolSchema.string("Skill name"))], required: ["name"]), readOnly: true) { args, _ in
				let name = (args["name"]?.stringValue ?? "").lowercased()
				let candidates = (project.map { SkillService(root: URL(fileURLWithPath: $0.skillsDir)).load(seedBuiltins: false) } ?? []) + skills.load()
				guard let skill = candidates.first(where: { $0.name.lowercased() == name || $0.dirName.lowercased() == name }) else {
					return ["error": .string("No skill named \(args["name"]?.stringValue ?? "").")]
				}
				return ["name": .string(skill.name), "instructions": .string(skill.bodyMarkdown), "tools": .array(skill.tools.map(JSONValue.string))]
			}, title: "Load skill", readOnly: true),
			ChatTool(tool: Tool(name: "createLocalSkill", description: "Create or update a SKILL.md skill (only when the user asks, or for this project's project-organization skill).", parameters: ToolSchema.object([
				("name", ToolSchema.string("Skill name")), ("description", ToolSchema.string("When to use it")), ("body", ToolSchema.string("Markdown instructions")),
				("tools", ToolSchema.array(["type": "string"], "Tool names the skill uses")), ("preferredFolderName", ToolSchema.string("Folder name")),
				("updateExisting", ToolSchema.boolean("Overwrite an existing skill")),
			], required: ["name", "description", "body"])) { args, _ in
				if dry { return ["dryRun": true] }
				let name = args["name"]?.stringValue ?? "skill"
				let folderName = ProjectService.slugify(args["preferredFolderName"]?.stringValue ?? name).nilIfEmpty ?? "skill"
				let root = (folderName == ProjectService.organizationSkillName ? project.map { URL(fileURLWithPath: $0.skillsDir) } : nil) ?? skills.root
				let file = root.appending(path: "\(folderName)/SKILL.md")
				if FileManager.default.fileExists(atPath: file.path), args["updateExisting"] != true {
					throw ToolError("A skill already exists in \(folderName). Pass updateExisting: true to replace it.")
				}
				let tools = (args["tools"]?.arrayValue ?? []).compactMap(\.stringValue)
				var markdown = "---\nname: \(name)\ndescription: \(MemoryText.collapseWhitespace(args["description"]?.stringValue ?? ""))\n"
				if !tools.isEmpty { markdown += "tools: \(tools.joined(separator: ", "))\n" }
				markdown += "---\n\n\(args["body"]?.stringValue ?? "")\n"
				try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
				try markdown.write(to: file, atomically: true, encoding: .utf8)
				return ["ok": true, "path": .string(file.path)]
			}, title: "Create skill", readOnly: false),
		]
	}

	// MARK: Graph & location

	func graphNeighbors() -> ChatTool {
		let graph = graph
		return ChatTool(tool: Tool(name: "graphNeighbors", description: "Find a person or entity and return its privacy-filtered neighborhood in Toby's knowledge graph.", parameters: ToolSchema.object([("entity", ToolSchema.string("Name or email"))], required: ["entity"]), readOnly: true) { args, _ in
			try graph.neighborhood(of: args["entity"]?.stringValue ?? "")
		}, title: "Look up connections", readOnly: true)
	}

	func myLocation(_ context: ChatToolContext) -> ChatTool {
		ChatTool(tool: Tool(name: "getMyLocation", description: "The Mac's current location (only for \"here\"/\"near me\"; saved addresses live in memory).", readOnly: true) { _, _ in
			guard let location = context.location else { return ["error": "Location is unavailable."] }
			return try await location()
		}, title: "Current location", readOnly: true)
	}

	// MARK: Web

	func webTools(_ context: ChatToolContext) -> [ChatTool] {
		let transport = transport
		let ai = ai
		var tools = [
			ChatTool(tool: Tool(name: "fetchWebContent", description: "Fetch a web page and return its readable text.", parameters: ToolSchema.object([("url", ToolSchema.string("http(s) URL"))], required: ["url"]), readOnly: true) { args, _ in
				guard let url = URL(string: args["url"]?.stringValue ?? ""), ["http", "https"].contains(url.scheme ?? "") else { throw ToolError("A http(s) URL is required.") }
				var request = URLRequest(url: url)
				request.timeoutInterval = 30
				request.setValue("Mozilla/5.0 (Macintosh) Toby", forHTTPHeaderField: "User-Agent")
				let (data, response) = try await transport.send(request)
				guard (200 ..< 400).contains(response.statusCode) else { throw ToolError("The page returned HTTP \(response.statusCode).") }
				if (response.value(forHTTPHeaderField: "Content-Type") ?? "").contains("pdf") || url.pathExtension.lowercased() == "pdf" {
					return ["url": .string(url.absoluteString), "text": .string(String((PDFDocument(data: data)?.string ?? "").prefix(40_000)))]
				}
				let html = String(decoding: data, as: UTF8.self)
				let text = Self.readableText(html)
				return ["url": .string(url.absoluteString), "title": .string(Self.htmlTitle(html) ?? ""), "text": .string(String(text.prefix(40_000))), "truncated": .bool(text.count > 40_000)]
			}, title: "Read web page", readOnly: true),
			ChatTool(tool: Tool(name: "readPdf", description: "Read text from a PDF by URL or project path.", parameters: ToolSchema.object([
				("url", ToolSchema.string("http(s) URL of the PDF")), ("path", ToolSchema.string("Project-relative PDF path")),
			]), readOnly: true) { args, _ in
				let data: Data
				if let path = args["path"]?.stringValue, let project = context.project {
					data = try Data(contentsOf: try Self.projectPath(project, path))
				} else if let url = URL(string: args["url"]?.stringValue ?? ""), ["http", "https"].contains(url.scheme ?? "") {
					data = try await transport.send(URLRequest(url: url)).0
				} else {
					throw ToolError("Provide a PDF url or a project path.")
				}
				guard let document = PDFDocument(data: data) else { throw ToolError("That isn't a readable PDF.") }
				let text = document.string ?? ""
				return ["pages": .number(Double(document.pageCount)), "text": .string(String(text.prefix(60_000))), "truncated": .bool(text.count > 60_000)]
			}, title: "Read PDF", readOnly: true),
			ChatTool(tool: Tool(name: "getWeather", description: "Current conditions and a daily forecast for a place (Open-Meteo).", parameters: ToolSchema.object([
				("location", ToolSchema.string("City or place name")), ("days", ToolSchema.integer("Forecast days (1–7)")),
				("latitude", ToolSchema.number("Latitude (instead of location)")), ("longitude", ToolSchema.number("Longitude")),
			]), readOnly: true) { args, _ in
				try await Self.weather(args, transport: transport)
			}, title: "Weather", readOnly: true),
		]
		if let ai {
			tools.append(ChatTool(tool: Tool(name: "webSearch", description: "Search the web for current information; returns an answer with sources.", parameters: ToolSchema.object([("query", ToolSchema.string("What to search for"))], required: ["query"]), readOnly: true) { args, _ in
				let result = try await generateText(TextRequest(
					model: ai.model(ModelDefaults.fast),
					instructions: "Answer the query from current web results. Be concise and factual; include source URLs.",
					messages: [.user(args["query"]?.stringValue ?? "")],
					maxOutputTokens: 1200,
					webSearch: WebSearchOptions(maxResults: 5),
				))
				return ["query": args["query"] ?? .null, "answer": .string(result.text)]
			}, title: "Web search", readOnly: true))
		}
		return tools
	}

	static func htmlTitle(_ html: String) -> String? {
		guard let match = html.firstMatch(of: /(?is)<title[^>]*>(.*?)<\/title>/) else { return nil }
		return decodeEntities(String(match.1)).trimmingCharacters(in: .whitespacesAndNewlines)
	}

	/// Strip scripts/styles/tags and collapse whitespace.
	static func readableText(_ html: String) -> String {
		var text = html.replacing(/(?is)<(script|style|noscript|svg|head)[^>]*>.*?<\/\1>/, with: " ")
		text = text.replacing(/(?i)<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/, with: "\n")
		text = text.replacing(/<[^>]+>/, with: " ")
		text = decodeEntities(text)
		return text.split(separator: "\n").map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }.filter { !$0.isEmpty }.joined(separator: "\n")
	}

	static func decodeEntities(_ text: String) -> String {
		[("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'")]
			.reduce(text) { $0.replacingOccurrences(of: $1.0, with: $1.1) }
	}

	static func weather(_ args: JSONValue, transport: any HTTPTransport) async throws -> JSONValue {
		var latitude = args["latitude"]?.doubleValue
		var longitude = args["longitude"]?.doubleValue
		var place = args["location"]?.stringValue ?? ""
		if latitude == nil || longitude == nil {
			var components = URLComponents(string: "https://geocoding-api.open-meteo.com/v1/search")!
			components.queryItems = [URLQueryItem(name: "name", value: place), URLQueryItem(name: "count", value: "1")]
			let (data, _) = try await transport.send(URLRequest(url: components.url!))
			guard let hit = try JSONDecoder().decode(JSONValue.self, from: data)["results"]?[0] else { throw ToolError("Couldn't find \(place).") }
			latitude = hit["latitude"]?.doubleValue
			longitude = hit["longitude"]?.doubleValue
			place = [hit["name"]?.stringValue, hit["admin1"]?.stringValue, hit["country"]?.stringValue].compactMap { $0 }.joined(separator: ", ")
		}
		guard let latitude, let longitude else { throw ToolError("A location is required.") }
		var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
		components.queryItems = [
			URLQueryItem(name: "latitude", value: String(latitude)), URLQueryItem(name: "longitude", value: String(longitude)),
			URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation"),
			URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset"),
			URLQueryItem(name: "timezone", value: "auto"), URLQueryItem(name: "forecast_days", value: String(min(7, max(1, args["days"]?.intValue ?? 3)))),
		]
		let (data, response) = try await transport.send(URLRequest(url: components.url!))
		guard (200 ..< 300).contains(response.statusCode) else { throw ToolError("Weather service returned HTTP \(response.statusCode).") }
		var forecast = try JSONDecoder().decode(JSONValue.self, from: data).objectValue ?? [:]
		forecast["place"] = .string(place)
		forecast["attribution"] = "Weather data by Open-Meteo.com (CC BY 4.0)"
		return .object(forecast)
	}
}
