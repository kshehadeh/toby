import Foundation
import GRDB
import TobyAI
import TobyMail

/// Tools a flow step can call: Toby todos, Mail, Slack, Calendar/Reminders/
/// Contacts/macOS (the native successors of the plugin modules).
public struct FlowTools: Sendable {
	let toolbox: ChatToolbox

	public init(toolbox: ChatToolbox) { self.toolbox = toolbox }

	static let appleModules: [(group: String, module: String, display: String)] = [
		("calendar", "applecalendar", "Apple Calendar"), ("reminders", "applereminders", "Apple Reminders"),
		("contacts", "applecontacts", "Apple Contacts"), ("macos", "macos", "macOS"),
	]
	/// Standard tool id → (module, tool).
	static let standardTools = [
		"email.unreadSummary": ("email", "getUnreadSummary"), "chat.mentionsSummary": ("slack", "getMentionsSummary"),
		"calendar.upcomingSummary": ("applecalendar", "getUpcomingSummary"), "tasks.openSummary": ("applereminders", "getOpenSummary"),
	]

	/// Picker modules plus the flat tool list and connected module names.
	public func catalog() -> (modules: [JSONValue], tools: [FlowDocuments.CatalogTool], connected: Set<String>) {
		var modules: [(name: String, display: String, connected: Bool, tools: [FlowDocuments.CatalogTool])] = []
		modules.append(("tobyTodos", "Toby Todos", true, ChatToolbox.todoDefinitions.map { d in
			FlowDocuments.CatalogTool(coreTool: "todos.\(d.action)", moduleName: "tobyTodos", toolName: "todos.\(d.action)", displayName: d.title,
			                          description: "\(d.title)\(ChatToolbox.todoSuffix)\(d.detail)", readOnly: d.readOnly, inputSchema: d.schema.value)
		}))
		if let mail = toolbox.mail {
			var tools = MailService.toolDefinitions.map { FlowDocuments.CatalogTool(moduleName: "email", toolName: $0.name, displayName: $0.title, description: $0.description, readOnly: $0.readOnly, inputSchema: $0.schema) }
			tools.append(FlowDocuments.CatalogTool(moduleName: "email", toolName: "getUnreadSummary", displayName: "Unread inbox summary", description: "Unread INBOX messages plus read-but-unanswered mail from people.",
			                                       readOnly: true, standardTool: "email.unreadSummary", inputSchema: ["type": "object", "properties": ["limit": ["type": "number"]]]))
			modules.append(("email", "Email", mail.isConfigured, tools))
		}
		if let slack = toolbox.slack {
			let tools = slack.tools(dryRun: false).map { tool in
				FlowDocuments.CatalogTool(moduleName: "slack", toolName: tool.tool.name, displayName: tool.title, description: tool.tool.description, readOnly: tool.readOnly,
				                          standardTool: tool.tool.name == "getMentionsSummary" ? "chat.mentionsSummary" : nil, inputSchema: tool.tool.parameters.value)
			}
			modules.append(("slack", "Slack", slack.isConfigured, tools))
		}
		if toolbox.apple != nil {
			for entry in Self.appleModules {
				var tools = AppleTools.definitions.filter { $0.group == entry.group }.map {
					FlowDocuments.CatalogTool(moduleName: entry.module, toolName: $0.name, displayName: $0.title, description: $0.description, readOnly: $0.readOnly, inputSchema: $0.schema)
				}
				if entry.module == "applecalendar" {
					tools.append(.init(moduleName: entry.module, toolName: "getUpcomingSummary", displayName: "Upcoming events", description: "Events in the next 7 days.", readOnly: true, standardTool: "calendar.upcomingSummary", inputSchema: ["type": "object", "properties": ["limit": ["type": "number"]]]))
				}
				if entry.module == "applereminders" {
					tools.append(.init(moduleName: entry.module, toolName: "getOpenSummary", displayName: "Open reminders", description: "Incomplete reminders.", readOnly: true, standardTool: "tasks.openSummary", inputSchema: ["type": "object", "properties": ["limit": ["type": "number"]]]))
				}
				if !tools.isEmpty { modules.append((entry.module, entry.display, true, tools)) }
			}
		}
		let json: [JSONValue] = modules.map { ["name": .string($0.name), "displayName": .string($0.display), "connected": .bool($0.connected), "tools": .array($0.tools.map(\.json))] }
		return (json, modules.flatMap(\.tools), Set(modules.filter(\.connected).map(\.name)))
	}

	public struct Execution: Sendable {
		public var result: JSONValue
		public var appliedActions: [String]
		public var moduleName: String
		public var toolName: String
		public var standardTool: String?
	}

	public struct ToolFailure: Error, LocalizedError, Sendable {
		public var message: String
		public var moduleName: String
		public var toolName: String
		public var errorDescription: String? { message }
	}

	/// Run one tool reference with resolved inputs.
	public func execute(_ ref: JSONValue, input: JSONValue, idempotencyKey: String?) async throws -> Execution {
		if let core = ref["coreTool"]?.stringValue {
			let action = core.hasPrefix("todos.") ? String(core.dropFirst(6)) : core
			guard let definition = ChatToolbox.todoDefinitions.first(where: { $0.action == action }) else { throw ToolFailure(message: "Unknown built-in tool: \(core)", moduleName: "tobyTodos", toolName: core) }
			do {
				let result = try toolbox.todos.execute(action, input: ToolSchema.stripNulls(input), context: TodoMutationContext(source: "flow", idempotencyKey: idempotencyKey))
				return Execution(result: result, appliedActions: definition.readOnly ? [] : [definition.title], moduleName: "tobyTodos", toolName: core)
			} catch {
				throw ToolFailure(message: (error as? LocalizedError)?.errorDescription ?? "\(error)", moduleName: "tobyTodos", toolName: core)
			}
		}
		var standard: String?
		var module = ref["moduleName"]?.stringValue ?? ""
		var name = ref["toolName"]?.stringValue ?? ""
		if let id = ref["standardTool"]?.stringValue {
			guard let target = Self.standardTools[id] else { throw ToolFailure(message: "No connected source implements \(id)", moduleName: "", toolName: id) }
			standard = id
			(module, name) = target
		}
		let limit = input["limit"]?.intValue ?? 20
		let result: JSONValue
		switch (module, name) {
		case ("email", "getUnreadSummary"):
			guard let mail = toolbox.mail else { throw ToolFailure(message: "Email isn't connected.", moduleName: module, toolName: name) }
			result = try await mail.unreadSummary(limit: limit)
		case ("applecalendar", "getUpcomingSummary"):
			guard let apple = toolbox.apple else { throw ToolFailure(message: "Calendar isn't available.", moduleName: module, toolName: name) }
			result = try await apple.upcomingEvents(limit: limit)
		case ("applereminders", "getOpenSummary"):
			guard let apple = toolbox.apple else { throw ToolFailure(message: "Reminders aren't available.", moduleName: module, toolName: name) }
			result = try await apple.openReminders(limit: limit)
		default:
			let context = ChatToolContext(sessionID: "flow", askUser: { _, _ in throw FlowRunner.NodeError("Flows run without asking questions.") })
			guard let tool = toolbox.tools(context).first(where: { $0.tool.name == name && Self.module(of: $0.tool.name, reported: module) }) else {
				throw ToolFailure(message: "Unknown tool \(module).\(name)", moduleName: module, toolName: name)
			}
			result = try await tool.tool.execute(input, ToolContext(toolCallId: idempotencyKey ?? UUID().uuidString))
			if result["ok"] == false || (result["error"]?.stringValue != nil && result.objectValue?.count == 1) {
				throw ToolFailure(message: result["error"]?.stringValue ?? "\(name) failed", moduleName: module, toolName: name)
			}
			let readOnly = tool.readOnly
			return Execution(result: result, appliedActions: readOnly ? [] : [tool.title], moduleName: module, toolName: name, standardTool: standard)
		}
		return Execution(result: result, appliedActions: [], moduleName: module, toolName: name, standardTool: standard)
	}

	/// Chat tool names are unique across modules; the module is informational.
	static func module(of tool: String, reported: String) -> Bool { true }
}

/// Runs flow documents (port of `runner.ts`, `nodes/*`, `prompt-template.ts`,
/// `extract-result.ts`, `deliver-destinations.ts`, `store.ts`).
public struct FlowRunner: Sendable {
	public struct NodeError: Error, LocalizedError, Sendable {
		public var message: String
		public var detail: JSONValue?
		public init(_ message: String, detail: JSONValue? = nil) {
			self.message = message
			self.detail = detail
		}
		public var errorDescription: String? { message }
	}

	public struct Result: Sendable {
		public var ok: Bool
		public var runID: String?
		public var error: String?
		public var failedNodeID: String?
		public var outputs: [String: JSONValue]
		public var extracted: JSONValue?
		public var destinations: [JSONValue]
		public var insufficientCredits = false
	}

	let writer: any DatabaseWriter
	let tools: FlowTools
	let personas: PersonaService
	let skills: SkillService
	let ai: OpenRouterClient
	let mail: MailService?
	let slack: SlackService?

	public init(writer: any DatabaseWriter, tools: FlowTools, personas: PersonaService, skills: SkillService, ai: OpenRouterClient, mail: MailService?, slack: SlackService?) {
		self.writer = writer
		self.tools = tools
		self.personas = personas
		self.skills = skills
		self.ai = ai
		self.mail = mail
		self.slack = slack
	}

	static func now() -> String { TodoRecurrence.isoString(Date()) }

	// MARK: Paths and templates

	public static func value(_ root: JSONValue?, path: String?) -> JSONValue? {
		guard let path, !path.isEmpty, path != "." else { return root }
		var current = root
		for part in path.split(separator: ".") {
			guard let object = current?.objectValue else { return nil }
			current = object[String(part)]
		}
		return current
	}

	static func resolveInputs(_ node: JSONValue, bag: [String: JSONValue], nodeID: String) throws -> [String: JSONValue] {
		var out: [String: JSONValue] = [:]
		for (name, source) in node["inputs"]?.objectValue ?? [:] {
			if let constant = source["const"] { out[name] = constant; continue }
			let from = source["from"]?.stringValue ?? ""
			guard let root = bag[from] else { throw NodeError("Missing context key \"\(from)\" for input \"\(name)\"") }
			let path = source["path"]?.stringValue
			guard let value = value(root, path: path) else { throw NodeError("Context key \"\(from)\" has no path \"\(path ?? "")\" for input \"\(name)\"") }
			out[name] = value
		}
		return out
	}

	static func text(_ value: JSONValue?, pretty: Bool) -> String {
		guard let value else { return "" }
		switch value {
		case .null: return "null"
		case let .string(text): return text
		case let .bool(flag): return flag ? "true" : "false"
		case let .number(number): return number == number.rounded() && abs(number) < 1e15 ? String(Int(number)) : String(number)
		default:
			guard pretty, let data = try? JSONEncoder.tobyPretty.encode(value) else { return value.jsonString() }
			return String(decoding: data, as: UTF8.self)
		}
	}

	static func dashboardItems(_ value: JSONValue?) -> String {
		let items = value?["items"]?.arrayValue ?? []
		guard !items.isEmpty else { return "(no items)" }
		return items.enumerated().map { index, item in
			var line = "\(index + 1). \(item["title"]?.stringValue?.nilIfEmpty ?? "(untitled)")"
			if let subtitle = item["subtitle"]?.stringValue { line += "\n   \(subtitle)" }
			if let detail = item["detail"]?.stringValue { line += "\n   \(detail)" }
			if let timestamp = item["timestamp"]?.stringValue { line += "\n   when: \(FeedText.localTimestamp(timestamp))" }
			if let urgency = item["urgency"]?.stringValue { line += "\n   urgency: \(urgency)" }
			if let url = item["url"]?.stringValue { line += "\n   URL: \(url)" }
			return line
		}.joined(separator: "\n")
	}

	nonisolated(unsafe) static let token = /\{\{\s*(dashboardItems\s+bag\.([a-zA-Z0-9_]+)|json\s+bag\.([a-zA-Z0-9_]+)|bag\.([a-zA-Z0-9_]+)|inputs\.([a-zA-Z0-9_]+))\s*\}\}/

	/// `{{bag.key}}`, `{{json bag.key}}`, `{{dashboardItems bag.key}}`, `{{inputs.name}}`.
	public static func render(_ template: String, bag: [String: JSONValue], inputs: [String: JSONValue]) -> String {
		template.replacing(token) { match in
			if let key = match.2 { return dashboardItems(bag[String(key)]) }
			if let key = match.3 { return text(bag[String(key)], pretty: true) }
			if let key = match.4 { return text(bag[String(key)], pretty: false) }
			if let key = match.5 { return text(inputs[String(key)], pretty: false) }
			return ""
		}
	}

	func systemPrompt(_ template: String, helpers: JSONValue?, persona: Persona, bag: [String: JSONValue], inputs: [String: JSONValue]) -> String {
		var out = Self.render(template, bag: bag, inputs: inputs)
		if helpers?["composePersona"] == true { out = ChatPrompt.compose(base: out, persona: persona) }
		if helpers?["appendSkillsCatalog"] == true {
			let catalog = SkillService.catalogForPrompt(skills.load().filter(\.enabled))
			if catalog != "(none)" { out += "\n\nAvailable skills (apply relevant context from these):\n\(catalog)" }
		}
		if helpers?["appendCurrentDateTime"] == true {
			out += "\n\n\(ChatPrompt.dateTimeSection())\n\nAll event times must be written in the user's local timezone above (never UTC or raw ISO strings)."
		}
		return out
	}

	// MARK: Persona

	func persona(for document: [String: JSONValue]) -> Persona {
		if document["persona"]?["source"] == "named", let name = document["persona"]?["name"]?.stringValue, let named = personas.resolve(name) { return named }
		return personas.defaultPersona()
	}

	// MARK: Nodes

	func llm(_ node: JSONValue, inputs: [String: JSONValue], bag: [String: JSONValue], persona: Persona) async throws -> (result: JSONValue, detail: JSONValue) {
		let system = systemPrompt(node["systemPrompt"]?.stringValue ?? "", helpers: node["promptHelpers"], persona: persona, bag: bag, inputs: inputs)
		let user = Self.render(node["userPrompt"]?.stringValue ?? "", bag: bag, inputs: inputs)
		let temperature = node["temperature"]?.doubleValue ?? 0.3
		let maxTokens = node["maxOutputTokens"]?.intValue ?? 3000
		let spec = node["schema"] ?? ["kind": "markdown"]
		let model = ai.model(persona.openRouterModel)
		var detail: [String: JSONValue] = [
			"kind": "llm_prompter", "model": ["provider": "openrouter", "modelId": .string(persona.openRouterModel)], "personaName": .string(persona.name),
			"temperature": .number(temperature), "maxOutputTokens": .number(Double(maxTokens)), "systemPrompt": .string(system), "userPrompt": .string(user),
		]
		if let name = node["schemaName"]?.stringValue { detail["schemaName"] = .string(name) }
		let timeout = Double(node["timeoutMs"]?.intValue ?? 45000) / 1000
		if spec["kind"] == "markdown" {
			detail["mode"] = "freeform"
			let result = try await Self.withTimeout(timeout) {
				try await generateText(TextRequest(
					model: model,
					instructions: "\(system)\nOUTPUT FORMAT:\n- Reply with ONLY the final user-facing content in markdown. Do not wrap the answer in JSON.\n- Do NOT include chain-of-thought, planning, or analysis of these instructions.",
					messages: [.user(user)], temperature: temperature, maxOutputTokens: maxTokens,
				))
			}
			let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !text.isEmpty else { throw NodeError("Model returned no usable free-form output", detail: .object(detail)) }
			detail["usage"] = ["inputTokens": .number(Double(result.usage.inputTokens)), "outputTokens": .number(Double(result.usage.outputTokens))]
			return (["markdown": .string(text)], .object(detail))
		}
		detail["mode"] = "structured"
		let schema = try FlowDocuments.schema(spec)
		let object = try await Self.withTimeout(timeout) {
			try await generateJSON(ObjectRequest(model: model, instructions: system, messages: [.user(user)], schema: schema,
			                                     schemaName: node["schemaName"]?.stringValue ?? "FlowStructuredOutput",
			                                     schemaDescription: node["schemaDescription"]?.stringValue ?? "Structured output for flow node",
			                                     temperature: temperature, maxOutputTokens: maxTokens))
		}
		// Same check as the daemon's Zod parse: every declared field, right type.
		for (field, spec) in spec["fields"]?.objectValue ?? [:] {
			let value = object.object[field]
			let ok: Bool = switch spec["type"]?.stringValue {
			case "string": value?.stringValue != nil
			case "boolean": value?.boolValue != nil
			case "number": value?.doubleValue != nil
			default: false
			}
			if !ok { throw NodeError("Model output field \"\(field)\" is not a \(spec["type"]?.stringValue ?? "value")", detail: .object(detail)) }
		}
		return (object.object, .object(detail))
	}

	static func withTimeout<T: Sendable>(_ seconds: Double, _ body: @escaping @Sendable () async throws -> T) async throws -> T {
		try await withThrowingTaskGroup(of: T.self) { group in
			group.addTask { try await body() }
			group.addTask {
				try await Task.sleep(for: .seconds(seconds))
				throw NodeError("Timed out after \(Int(seconds))s")
			}
			let first = try await group.next()!
			group.cancelAll()
			return first
		}
	}

	func agent(_ node: JSONValue, inputs: [String: JSONValue], bag: [String: JSONValue], persona base: Persona, projectID: String?) async throws -> (result: JSONValue, detail: JSONValue) {
		let prompt = Self.render(node["userPrompt"]?.stringValue ?? "", bag: bag, inputs: inputs)
		var persona = base
		persona.instructions = "\(base.instructions)\n\n\(node["systemPrompt"]?.stringValue ?? "")\n\nThis is a Flow task. Complete it without asking questions or waiting for user input. Use your best judgment. Do not call askUser."
		let project = try projectID.flatMap { try tools.toolbox.projects.resolve($0) }
		if let projectID, project == nil { throw NodeError("Project \"\(projectID)\" not found") }
		let instructions = systemPrompt("Complete the requested Flow task using the available tools.", helpers: ["composePersona": true, "appendSkillsCatalog": true, "appendCurrentDateTime": true],
		                                persona: persona, bag: bag, inputs: inputs)
		let applied = AppliedLog()
		let context = ChatToolContext(sessionID: "flow", project: project, askUser: { _, _ in throw NodeError("Flows run without asking questions.") })
		let chatTools = tools.toolbox.tools(context).filter { $0.tool.name != "askUser" }
		let wrapped: [Tool] = chatTools.map { chatTool in
			var tool = chatTool.tool
			let execute = tool.execute
			let title = chatTool.title
			let readOnly = chatTool.readOnly
			tool.execute = { args, ctx in
				let result = try await execute(args, ctx)
				if !readOnly, result["ok"] != false, result["error"] == nil { applied.add(title) }
				return result
			}
			return tool
		}
		let result = try await generateText(TextRequest(model: ai.model(persona.openRouterModel), instructions: instructions, messages: [.user(prompt)], tools: wrapped, stopWhen: .stepCount(12)))
		return (["markdown": .string(result.text.trimmingCharacters(in: .whitespacesAndNewlines))], [
			"kind": "agent_task", "prompt": .string(prompt), "projectId": projectID.map(JSONValue.string) ?? .null, "transcript": [], "warnings": [],
			"appliedActions": .array(applied.titles.map(JSONValue.string)),
		])
	}

	// MARK: Run

	public struct Options: Sendable {
		public var inputs: [String: JSONValue] = [:]
		public var trigger: String?
		public var record = true
		public var deliver = true
		public init(inputs: [String: JSONValue] = [:], trigger: String? = nil, record: Bool = true, deliver: Bool = true) {
			self.inputs = inputs
			self.trigger = trigger
			self.record = record
			self.deliver = deliver
		}
	}

	static func snapshot(_ document: [String: JSONValue]) -> JSONValue {
		var out: [String: JSONValue] = ["name": document["id"] ?? "", "nodes": .array((document["nodes"]?.arrayValue ?? []).map { node in
			var entry: [String: JSONValue] = ["id": node["id"] ?? "", "type": node["type"] ?? ""]
			for key in ["tool", "when", "inputs", "outputs", "temperature", "maxOutputTokens", "schemaName"] { if let value = node[key] { entry[key] = value } }
			if node["type"] == "llm_prompter", let schema = node["schema"] { entry["schema"] = schema }
			return .object(entry)
		})]
		if let description = document["description"] { out["description"] = description }
		return .object(out)
	}

	/// Run a stored flow document end to end (record, extract, deliver).
	public func run(_ document: [String: JSONValue], options: Options = Options()) async -> Result {
		let id = document["id"]?.stringValue ?? "flow"
		let persona = persona(for: document)
		let started = Date()
		var bag = options.inputs
		var runID: String?
		if options.record {
			let newID = UUID().uuidString.lowercased()
			let inserted: Void? = try? await writer.write { db in
				try db.execute(sql: """
				INSERT INTO flow_runs (id, flow_name, status, persona_name, provider, model, trigger, definition_snapshot_json, initial_inputs_json, started_at)
				VALUES (?, ?, 'running', ?, 'openrouter', ?, ?, ?, ?, ?)
				""", arguments: [newID, id, persona.name, persona.openRouterModel, options.trigger, Self.snapshot(document).jsonString(), JSONValue.object(options.inputs).jsonString(), TodoRecurrence.isoString(started)])
			}
			if inserted != nil { runID = newID }
		}
		let invocation = runID ?? UUID().uuidString.lowercased()
		let nodes = document["nodes"]?.arrayValue ?? []
		var lastResult: JSONValue?
		for (order, node) in nodes.enumerated() {
			let nodeID = node["id"]?.stringValue ?? "node\(order)"
			let type = node["type"]?.stringValue ?? ""
			let nodeStart = Date()
			let rowID = UUID().uuidString.lowercased()
			if let runID {
				_ = try? await writer.write { db in
					try db.execute(sql: "INSERT INTO flow_run_nodes (id, run_id, node_id, node_type, node_order, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)",
					               arguments: [rowID, runID, nodeID, type, order, TodoRecurrence.isoString(nodeStart)])
				}
			}
			var inputs: [String: JSONValue] = [:]
			do {
				try Task.checkCancellation()
				if type == "tool_executor", let when = node["when"] {
					let condition = try Self.resolveInputs(["inputs": ["condition": when]], bag: bag, nodeID: nodeID)["condition"]
					guard let flag = condition?.boolValue else { throw NodeError("Action condition must resolve to a boolean") }
					if !flag {
						let skipped: JSONValue = ["skipped": true, "reason": "Action condition was false", "condition": when, "value": false]
						lastResult = skipped
						try await finishNode(rowID, runID: runID, status: "skipped", inputs: [:], outputs: ["bagWrites": [:], "nodeResult": skipped], detail: nil, error: nil, started: nodeStart)
						continue
					}
				}
				inputs = try Self.resolveInputs(node, bag: bag, nodeID: nodeID)
				let nodeResult: JSONValue
				let detail: JSONValue?
				let defaultOutputs: [String: JSONValue]
				switch type {
				case "tool_executor":
					let execution: FlowTools.Execution
					do {
						execution = try await tools.execute(node["tool"] ?? [:], input: .object(inputs), idempotencyKey: "flow:\(invocation):\(nodeID)")
					} catch let failure as FlowTools.ToolFailure {
						throw NodeError(failure.message, detail: ["kind": "tool_executor", "tool": node["tool"] ?? .null, "toolCalls": [["moduleName": .string(failure.moduleName), "toolName": .string(failure.toolName), "input": .object(inputs), "ok": false, "error": .string(failure.message)]]])
					}
					var result: [String: JSONValue] = ["result": execution.result, "moduleName": .string(execution.moduleName), "toolName": .string(execution.toolName)]
					if !execution.appliedActions.isEmpty { result["appliedActions"] = .array(execution.appliedActions.map(JSONValue.string)) }
					if let standard = execution.standardTool { result["standardTool"] = .string(standard) }
					nodeResult = .object(result)
					detail = ["kind": "tool_executor", "tool": node["tool"] ?? .null, "resolved": ["moduleName": .string(execution.moduleName), "toolName": .string(execution.toolName)],
					          "toolCalls": [["moduleName": .string(execution.moduleName), "toolName": .string(execution.toolName), "input": .object(inputs), "ok": true, "result": execution.result, "error": .null]]]
					defaultOutputs = ["result": "result"]
				case "agent_task":
					let out = try await agent(node, inputs: inputs, bag: bag, persona: persona, projectID: document["projectId"]?.stringValue)
					nodeResult = ["object": out.result, "detail": out.detail]
					detail = out.detail
					defaultOutputs = ["object": "object"]
				case "llm_prompter":
					let out = try await llm(node, inputs: inputs, bag: bag, persona: persona)
					nodeResult = ["object": out.result, "detail": out.detail]
					detail = out.detail
					defaultOutputs = ["object": "object"]
				default:
					throw NodeError("Unsupported node type \"\(type)\"")
				}
				var writes: [String: JSONValue] = [:]
				for (key, path) in (node["outputs"]?.objectValue ?? defaultOutputs) {
					let pathText = path.stringValue ?? "."
					let value = Self.value(nodeResult, path: pathText)
					if value == nil, pathText != ".", !pathText.isEmpty { throw NodeError("Node result has no path \"\(pathText)\" for output key \"\(key)\"") }
					writes[key] = value ?? .null
				}
				bag.merge(writes) { _, new in new }
				lastResult = nodeResult
				try await finishNode(rowID, runID: runID, status: "success", inputs: .object(inputs), outputs: ["bagWrites": .object(writes), "nodeResult": nodeResult], detail: detail, error: nil, started: nodeStart)
			} catch {
				let message = (error as? LocalizedError)?.errorDescription ?? "\(error)"
				let credits: Bool = if case AIError.insufficientCredits = error { true } else { false }
				try? await finishNode(rowID, runID: runID, status: "error", inputs: .object(inputs), outputs: .null, detail: (error as? NodeError)?.detail, error: message, started: nodeStart)
				try? await finishRun(runID, status: "error", outputs: bag, error: message, failedNode: nodeID, started: started)
				return Result(ok: false, runID: runID, error: message, failedNodeID: nodeID, outputs: bag, extracted: nil, destinations: [], insufficientCredits: credits)
			}
		}
		try? await finishRun(runID, status: "success", outputs: bag, error: nil, failedNode: nil, started: started)
		let extracted = Self.extract(bag: bag, document: document, lastResult: lastResult)
		guard options.deliver else { return Result(ok: true, runID: runID, outputs: bag, extracted: extracted, destinations: []) }
		let deliveries = await deliver(document["destinations"]?.arrayValue ?? [], text: extracted["text"]?.stringValue ?? "")
		let failed = deliveries.filter { !["modal", "dashboard"].contains($0["type"]?.stringValue ?? "") && $0["ok"] != true }
		let failure = failed.isEmpty ? nil : failed.map { $0["error"]?.stringValue ?? "\($0["type"]?.stringValue ?? "") destination failed" }.joined(separator: "; ")
		if let runID {
			_ = try? await writer.write { db in
				try db.execute(sql: "UPDATE flow_runs SET destination_results_json = ?, error = COALESCE(?, error) WHERE id = ?", arguments: [JSONValue.array(deliveries).jsonString(), failure, runID])
			}
		}
		return Result(ok: failure == nil, runID: runID, error: failure, outputs: bag, extracted: extracted, destinations: deliveries)
	}

	func finishNode(_ id: String, runID: String?, status: String, inputs: JSONValue, outputs: JSONValue, detail: JSONValue?, error: String?, started: Date) async throws {
		guard runID != nil else { return }
		try await writer.write { db in
			try db.execute(sql: "UPDATE flow_run_nodes SET status = ?, inputs_json = ?, outputs_json = ?, detail_json = ?, error = ?, duration_ms = ?, completed_at = ? WHERE id = ?",
			               arguments: [status, inputs.jsonString(), outputs.jsonString(), (detail ?? .null).jsonString(), error, Int(Date().timeIntervalSince(started) * 1000), Self.now(), id])
		}
	}

	func finishRun(_ id: String?, status: String, outputs: [String: JSONValue], error: String?, failedNode: String?, started: Date) async throws {
		guard let id else { return }
		try await writer.write { db in
			try db.execute(sql: "UPDATE flow_runs SET status = ?, final_outputs_json = ?, error = ?, failed_node_id = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
			               arguments: [status, JSONValue.object(outputs).jsonString(), error, failedNode, Self.now(), Int(Date().timeIntervalSince(started) * 1000), id])
		}
	}

	// MARK: Result

	static func pointer(_ document: [String: JSONValue]) -> (from: String, path: String?) {
		if let from = document["result"]?["from"]?.stringValue?.trimmingCharacters(in: .whitespaces), !from.isEmpty { return (from, document["result"]?["path"]?.stringValue) }
		guard let last = document["nodes"]?.arrayValue?.last else { return ("result", nil) }
		func key(_ preferred: String, _ fallback: String) -> String {
			guard let outputs = last["outputs"]?.objectValue else { return fallback }
			return outputs.first { $0.value.stringValue == preferred || $0.value.stringValue == "." || $0.value.stringValue == "" }?.key ?? outputs.keys.sorted().first ?? fallback
		}
		if last["type"] == "tool_executor" { return (key("result", "result"), nil) }
		let from = key("object", "object")
		return last["type"] == "agent_task" || last["schema"]?["kind"] == "markdown" ? (from, "markdown") : (from, nil)
	}

	/// `{text, format, pointer}` for the run's declared or inferred result.
	public static func extract(bag: [String: JSONValue], document: [String: JSONValue], lastResult: JSONValue?) -> JSONValue {
		let (from, path) = pointer(document)
		var pointerJSON: [String: JSONValue] = ["from": .string(from)]
		if let path { pointerJSON["path"] = .string(path) }
		if document["result"] == nil, lastResult?["skipped"] == true {
			return ["text": "Action skipped because its condition was false.", "format": "plain", "pointer": .object(pointerJSON)]
		}
		let value = Self.value(bag[from], path: path)
		func actions(_ value: JSONValue?) -> String? {
			guard let list = value?["appliedActions"]?.arrayValue, !list.isEmpty else { return nil }
			let strings = list.compactMap { $0.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty }
			return strings.count == list.count ? strings.joined(separator: "\n") : nil
		}
		var text = ""
		var format = "plain"
		if let string = value?.stringValue {
			text = string.trimmingCharacters(in: .whitespacesAndNewlines)
			format = text.firstMatch(of: /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*]\s|\*\*[^*]+\*\*|`[^`]+`/) != nil ? "markdown" : "plain"
		} else if let markdown = value?["markdown"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !markdown.isEmpty {
			text = markdown
			format = "markdown"
		} else if let list = actions(value) {
			text = list
		} else if let message = value?["message"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
			text = message
		} else if let list = actions(lastResult) {
			text = list
		} else if let value, !value.isNull {
			if value.objectValue != nil || value.arrayValue != nil {
				text = (try? JSONEncoder.tobyPretty.encode(value)).map { String(decoding: $0, as: UTF8.self) } ?? value.jsonString()
				format = "json"
			} else {
				text = Self.text(value, pretty: false)
			}
		}
		if path == "markdown", !text.isEmpty { format = "markdown" }
		return ["text": .string(text), "format": .string(format), "pointer": .object(pointerJSON)]
	}

	func deliver(_ destinations: [JSONValue], text: String) async -> [JSONValue] {
		var out: [JSONValue] = []
		for destination in destinations {
			let type = destination["type"]?.stringValue ?? ""
			if type == "modal" || type == "dashboard" { out.append(["type": .string(type), "ok": true]); continue }
			guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { out.append(["type": .string(type), "ok": false, "error": "Flow produced an empty result"]); continue }
			do {
				if type == "email" {
					guard let mail else { throw NodeError("Email isn't connected.") }
					_ = try await mail.send(to: (destination["to"]?.arrayValue ?? []).compactMap(\.stringValue), cc: (destination["cc"]?.arrayValue ?? []).compactMap(\.stringValue),
					                        subject: destination["subject"]?.stringValue ?? "", body: text)
				} else if type == "slack" {
					guard let slack else { throw NodeError("Slack isn't connected.") }
					_ = try await slack.post(channel: destination["channel"]?.stringValue ?? "", text: text)
				} else {
					throw NodeError("Unknown destination \(type)")
				}
				out.append(["type": .string(type), "ok": true])
			} catch {
				out.append(["type": .string(type), "ok": false, "error": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")])
			}
		}
		return out
	}

	// MARK: History

	static func summaryJSON(_ row: Row) -> JSONValue {
		[
			"id": .string(row["id"]), "flowName": .string(row["flow_name"]), "status": .string(row["status"]),
			"personaName": (row["persona_name"] as String?).map(JSONValue.string) ?? .null, "provider": (row["provider"] as String?).map(JSONValue.string) ?? .null,
			"model": (row["model"] as String?).map(JSONValue.string) ?? .null, "trigger": (row["trigger"] as String?).map(JSONValue.string) ?? .null,
			"error": (row["error"] as String?).map(JSONValue.string) ?? .null, "failedNodeId": (row["failed_node_id"] as String?).map(JSONValue.string) ?? .null,
			"startedAt": .string(row["started_at"]), "completedAt": (row["completed_at"] as String?).map(JSONValue.string) ?? .null,
			"durationMs": (row["duration_ms"] as Int?).map { .number(Double($0)) } ?? .null,
		]
	}

	static func optional(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
	static func optional(_ value: Int?) -> JSONValue { value.map { .number(Double($0)) } ?? .null }

	static func nodeJSON(_ node: Row) -> JSONValue {
		var out: [String: JSONValue] = [:]
		out["id"] = .string(node["id"])
		out["runId"] = .string(node["run_id"])
		out["nodeId"] = .string(node["node_id"])
		out["nodeType"] = .string(node["node_type"])
		out["nodeOrder"] = .number(Double(node["node_order"] as Int))
		out["status"] = .string(node["status"])
		out["inputs"] = parse(node["inputs_json"])
		out["outputs"] = parse(node["outputs_json"])
		out["error"] = optional(node["error"] as String?)
		out["durationMs"] = optional(node["duration_ms"] as Int?)
		out["startedAt"] = optional(node["started_at"] as String?)
		out["completedAt"] = optional(node["completed_at"] as String?)
		out["detail"] = parse(node["detail_json"])
		return .object(out)
	}

	static func parse(_ raw: String?) -> JSONValue { raw.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) } ?? .null }

	public func runs(flowName: String?, limit: Int, offset: Int) throws -> [JSONValue] {
		try writer.read { db in
			let filter = flowName == nil ? "" : "WHERE flow_name = ?"
			return try Row.fetchAll(db, sql: "SELECT * FROM flow_runs \(filter) ORDER BY started_at DESC LIMIT ? OFFSET ?",
			                        arguments: StatementArguments((flowName.map { [$0] } ?? []) + [String(limit), String(offset)])).map(Self.summaryJSON)
		}
	}

	public func run(id: String) throws -> JSONValue? {
		try writer.read { db in
			guard let row = try Row.fetchOne(db, sql: "SELECT * FROM flow_runs WHERE id = ?", arguments: [id]) else { return nil }
			var out = Self.summaryJSON(row).objectValue ?? [:]
			let snapshot = Self.parse(row["definition_snapshot_json"])
			out["definitionSnapshot"] = snapshot.isNull ? ["name": .string(row["flow_name"]), "nodes": []] : snapshot
			out["initialInputs"] = Self.parse(row["initial_inputs_json"])
			out["finalOutputs"] = Self.parse(row["final_outputs_json"])
			let destinations = Self.parse(row["destination_results_json"])
			out["destinationResults"] = destinations.arrayValue != nil ? destinations : .null
			out["nodes"] = .array(try Row.fetchAll(db, sql: "SELECT * FROM flow_run_nodes WHERE run_id = ? ORDER BY node_order ASC", arguments: [id]).map(Self.nodeJSON))
			return .object(out)
		}
	}
}

final class AppliedLog: @unchecked Sendable {
	private let lock = NSLock()
	private var stored: [String] = []
	func add(_ title: String) { lock.withLock { if !stored.contains(title) { stored.append(title) } } }
	var titles: [String] { lock.withLock { stored } }
}
