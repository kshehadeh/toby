import Foundation
import TobyAI

/// Runs chat turns natively (port of `chat-pipeline/*` + `ai/chat.ts`):
/// assemble the prompt and history, stream the model with Toby's tools, emit
/// the same chat events the daemon streamed, and persist messages + transcript.
public actor ChatEngine {
	public struct Attachment: Sendable {
		public var filename: String
		public var mediaType: String
		public var dataBase64: String
		public var byteSize: Int

		public init(filename: String, mediaType: String, dataBase64: String, byteSize: Int) {
			self.filename = filename
			self.mediaType = mediaType
			self.dataBase64 = dataBase64
			self.byteSize = byteSize
		}

		var json: JSONValue {
			["filename": .string(filename), "mediaType": .string(mediaType), "dataBase64": .string(dataBase64), "byteSize": .number(Double(byteSize))]
		}
	}

	public typealias AskUser = @Sendable (_ turnID: String, _ query: String, _ options: [String]) async throws -> (index: Int, label: String, rawInput: String)

	let sessions: ChatSessionStore
	let toolbox: ChatToolbox
	let personas: PersonaService
	let ai: OpenRouterClient
	let catalog: ModelCatalog
	/// Overrides the persona's model (Advanced chat-model picker).
	let chatModelOverride: @Sendable () -> String?
	let location: (@Sendable () async throws -> JSONValue)?
	var active: [String: Task<JSONValue, Error>] = [:]

	public static let maxSteps = 12

	public init(
		sessions: ChatSessionStore,
		toolbox: ChatToolbox,
		personas: PersonaService,
		ai: OpenRouterClient,
		chatModelOverride: @escaping @Sendable () -> String? = { nil },
		location: (@Sendable () async throws -> JSONValue)? = nil,
	) {
		self.sessions = sessions
		self.toolbox = toolbox
		self.personas = personas
		self.ai = ai
		catalog = ModelCatalog(client: ai)
		self.chatModelOverride = chatModelOverride
		self.location = location
	}

	/// Cancel a running turn.
	public func cancel(turnID: String) {
		active[turnID]?.cancel()
	}

	/// Run one turn. `onEvent` receives each chat event (daemon SSE shape);
	/// returns the `done` payload (turnId, text, appliedActions, sessionName, usage, contextWindow).
	public func runTurn(
		sessionID: String,
		text: String,
		attachments: [Attachment] = [],
		turnID requestedTurnID: String? = nil,
		onEvent: @escaping @Sendable (JSONValue) -> Void,
		askUser: @escaping AskUser,
	) async throws -> JSONValue {
		let turnID = requestedTurnID ?? UUID().uuidString.lowercased()
		let task = Task { [self] in
			try await execute(sessionID: sessionID, text: text, attachments: attachments, turnID: turnID, onEvent: onEvent, askUser: askUser)
		}
		active[turnID] = task
		defer { active[turnID] = nil }
		return try await task.value
	}

	// MARK: Turn

	final class EventSink: @unchecked Sendable {
		private let lock = NSLock()
		private var seq = 0
		private(set) var reducer: ChatTranscript.Reducer
		let forward: @Sendable (JSONValue) -> Void

		init(reducer: ChatTranscript.Reducer, forward: @escaping @Sendable (JSONValue) -> Void) {
			self.reducer = reducer
			self.forward = forward
		}

		func emit(_ fields: [String: JSONValue]) {
			let event: JSONValue = lock.withLock {
				seq += 1
				var object = fields
				object["seq"] = .number(Double(seq))
				let event = JSONValue.object(object)
				reducer.apply(event)
				return event
			}
			forward(event)
		}

		func mutate(_ body: (inout ChatTranscript.Reducer) -> Void) {
			lock.withLock { body(&reducer) }
		}

		var entries: [JSONValue] { lock.withLock { reducer.entries } }
	}

	func execute(sessionID: String, text: String, attachments: [Attachment], turnID: String, onEvent: @escaping @Sendable (JSONValue) -> Void, askUser: @escaping AskUser) async throws -> JSONValue {
		guard let session = try sessions.load(sessionID) else { throw TodoError("not_found", "Session not found", status: 404) }
		let started = ContinuousClock.now
		let project = try session.projectID.flatMap { try toolbox.projects.resolve($0) }
		let persona = (session.personaName ?? project?.personaName).flatMap(personas.resolve) ?? personas.defaultPersona()
		let modelID = chatModelOverride()?.nilIfEmpty ?? persona.openRouterModel
		let context = ChatToolContext(
			sessionID: sessionID, project: project, dryRun: session.settings["dryRun"] == true,
			askUser: { query, options in try await askUser(turnID, query, options) }, location: location,
		)
		let tools = toolbox.tools(context)
		let titles = Dictionary(tools.map { ($0.tool.name, $0.title) }, uniquingKeysWith: { a, _ in a })
		let sink = EventSink(reducer: ChatTranscript.Reducer(entries: session.transcript, titles: titles), forward: onEvent)
		let transcriptFrom = session.transcript.count
		let now = TodoRecurrence.isoString(Date())
		sink.mutate { $0.addUser(text, attachments: attachments.map(\.json), createdAt: now) }

		let userMessage = Self.userMessage(text: text, attachments: attachments)
		let lifecycleID = UUID().uuidString.lowercased()
		sink.emit(["type": "lifecycle_start", "id": .string(lifecycleID), "header": .string("Chatting with \(persona.name)")])

		let modelInfo = try? await catalog.model(modelID)
		let history = Self.compact(session.messages, contextTokens: modelInfo?.contextLength ?? 128_000)
		let instructions = systemPrompt(persona: persona, project: project)

		var assistantSegment: String?
		var reasoningSegment: String?
		var modelRequest: String?
		var sawContent = false
		var finalResult: TextResult?
		var produced: [Message] = []
		var applied: [String] = []
		var usedTools = false
		let readOnly = Dictionary(tools.map { ($0.tool.name, $0.readOnly) }, uniquingKeysWith: { a, _ in a })

		func endAssistant(interim: Bool) {
			guard let id = assistantSegment else { return }
			sink.emit(["type": "assistant_segment_end", "id": .string(id), "interim": .bool(interim)])
			assistantSegment = nil
		}
		func endReasoning() {
			guard let id = reasoningSegment else { return }
			sink.emit(["type": "reasoning_end", "id": .string(id)])
			reasoningSegment = nil
		}
		func contentStarted(_ detail: String) {
			guard !sawContent, let modelRequest else { return }
			sawContent = true
			sink.emit(["type": "lifecycle_end", "id": .string(modelRequest), "detail": .string(detail)])
		}

		do {
			let request = TextRequest(
				model: ai.model(modelID),
				instructions: instructions,
				messages: [.system(ChatPrompt.dateTimeSection())] + history + [userMessage],
				tools: tools.map(\.tool),
				stopWhen: .stepCount(Self.maxSteps),
			)
			for try await part in streamText(request) {
				switch part {
				case .stepStart:
					sawContent = false
					let id = UUID().uuidString.lowercased()
					modelRequest = id
					sink.emit(["type": "lifecycle_start", "id": .string(id), "header": "Sending request to model…"])
				case let .reasoningDelta(delta):
					contentStarted("Model is thinking…")
					if reasoningSegment == nil {
						reasoningSegment = UUID().uuidString.lowercased()
						sink.emit(["type": "reasoning_start", "id": .string(reasoningSegment!)])
					}
					sink.emit(["type": "reasoning_delta", "segmentId": .string(reasoningSegment!), "delta": .string(delta)])
				case let .textDelta(delta):
					contentStarted("Streaming assistant output…")
					endReasoning()
					if assistantSegment == nil {
						assistantSegment = UUID().uuidString.lowercased()
						sink.emit(["type": "assistant_segment_start", "id": .string(assistantSegment!), "header": .string(persona.name)])
					}
					sink.emit(["type": "assistant_text_delta", "segmentId": .string(assistantSegment!), "delta": .string(delta)])
				case let .toolCallStart(id, name):
					contentStarted("Model turn continued (tools or structured output).")
					endReasoning()
					endAssistant(interim: true)
					usedTools = true
					sink.emit(["type": "tool_call_start", "blockKey": .string(id), "toolName": .string(name), "args": .object([:])])
				case let .toolCall(call):
					let args = (try? call.parsedArguments()) ?? .object([:])
					if case let .object(object) = args, !object.isEmpty {
						sink.emit(["type": "tool_call_start", "blockKey": .string(call.id), "toolName": .string(call.name), "args": args, "argsUpdate": true])
					}
				case let .toolProgress(id, progress):
					let name = sink.entries.last { $0["toolBlockKey"]?.stringValue == id }?["toolName"]?.stringValue ?? ""
					var fields: [String: JSONValue] = [
						"type": "tool_call_progress", "blockKey": .string(id), "toolName": .string(name),
						"items": [["id": .string(id), "label": .string(progress.message ?? "Working…"), "state": "running"]],
					]
					if let fraction = progress.fraction { fields["fraction"] = .number(fraction) }
					sink.emit(fields)
				case let .toolResult(record):
					var fields: [String: JSONValue] = [
						"type": "tool_call_complete", "blockKey": .string(record.callId), "toolName": .string(record.toolName),
						"args": record.arguments.objectValue.map(JSONValue.object) ?? .object([:]), "result": record.result,
						"durationMs": .number(Double(record.durationMs)),
					]
					if record.isError { fields["error"] = record.result["error"] ?? .string("Tool failed") }
					sink.emit(fields)
					let failed = record.isError || record.result["ok"] == false
					if readOnly[record.toolName] == false, !failed, let title = titles[record.toolName], !applied.contains(title) {
						applied.append(title)
					}
				case let .stepFinish(step):
					if !sawContent, let modelRequest {
						sawContent = true
						sink.emit(["type": "lifecycle_end", "id": .string(modelRequest), "detail": "Model turn continued (tools or structured output)."])
					}
					endReasoning()
					endAssistant(interim: !step.toolCalls.isEmpty)
					produced += step.responseMessages
				case let .finish(result):
					finalResult = result
				case .toolCallArgumentsDelta:
					break
				}
			}
		} catch {
			endReasoning()
			endAssistant(interim: false)
			let cancelled = (error as? AIError) == .cancelled || error is CancellationError
			sink.mutate { reducer in
				if cancelled { reducer.addNotice("Stopped.", tone: "info") } else { reducer.addError((error as? LocalizedError)?.errorDescription ?? String(describing: error)) }
			}
			try? sessions.saveTurn(sessionID, messages: [userMessage] + produced, transcript: sink.entries, transcriptFrom: transcriptFrom, contextWindow: nil)
			throw cancelled ? AIError.cancelled : error
		}

		let elapsed = ContinuousClock.now - started
		if usedTools {
			sink.mutate { $0.addTurnWork(durationMs: Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)) }
		}
		let result = finalResult
		let usage = result?.usage ?? .zero
		let contextTokens = modelInfo?.contextLength
		let lastInput = result?.steps.last?.usage.inputTokens ?? usage.inputTokens
		let contextWindow: JSONValue = contextTokens.map { tokens in
			["supported": true, "contextWindowTokens": .number(Double(tokens)), "fillPercentage": .number(Double(min(100, Int((Double(lastInput) / Double(max(tokens, 1)) * 100).rounded()))))]
		} ?? ["supported": false, "unavailableReason": "Model context size is unknown."]
		try sessions.saveTurn(sessionID, messages: [userMessage] + (result?.responseMessages ?? produced), transcript: sink.entries, transcriptFrom: transcriptFrom, contextWindow: contextWindow)

		var sessionName: String?
		if session.name == "New chat" || session.name.isEmpty, let title = await Self.title(for: text, reply: result?.text ?? "", ai: ai) {
			try? sessions.rename(sessionID, to: title)
			sessionName = title
		}
		var usageJSON: [String: JSONValue] = [
			"inputTokens": .number(Double(usage.inputTokens)), "outputTokens": .number(Double(usage.outputTokens)), "totalTokens": .number(Double(usage.totalTokens)),
		]
		if let read = usage.cacheReadTokens { usageJSON["cacheReadTokens"] = .number(Double(read)) }
		if let write = usage.cacheWriteTokens { usageJSON["cacheWriteTokens"] = .number(Double(write)) }
		return [
			"turnId": .string(turnID), "text": .string(result?.text ?? ""), "appliedActions": .array(applied.map(JSONValue.string)),
			"sessionName": sessionName.map(JSONValue.string) ?? .null, "usage": .object(usageJSON), "contextWindow": contextWindow,
		]
	}

	// MARK: Helpers

	nonisolated func systemPrompt(persona: Persona, project: ProjectService.Project?) -> String {
		let globalSkills = toolbox.skills.load().filter(\.enabled)
		let projectSkills = project.map { SkillService(root: URL(fileURLWithPath: $0.skillsDir)).load(seedBuiltins: false) } ?? []
		var prompt = ChatPrompt.compose(
			base: ChatPrompt.basePrompt(hasWebSearch: true, hasProject: project != nil, skillsCatalog: SkillService.catalogForPrompt(globalSkills + projectSkills)),
			persona: persona,
		)
		if let project { prompt += ChatPrompt.projectSection(project, documents: toolbox.projects.contextDocuments(project)) }
		prompt += ChatPrompt.memoriesSection((try? toolbox.memory.usableForPrompt()) ?? [])
		return prompt
	}

	static func userMessage(text: String, attachments: [Attachment]) -> Message {
		guard !attachments.isEmpty else { return .user(text) }
		var parts: [ContentPart] = [.text(text)]
		for attachment in attachments {
			let type = attachment.mediaType.lowercased()
			if type.hasPrefix("image/") {
				parts.append(.image(url: "data:\(type);base64,\(attachment.dataBase64)"))
			} else if type.hasPrefix("text/") || LibraryMedia.catalogStorage(filename: attachment.filename, mediaType: type).mimeType == "text/plain",
			          let data = Data(base64Encoded: attachment.dataBase64), let body = String(data: data, encoding: .utf8)
			{
				parts.append(.text("Attached file \(attachment.filename):\n\(String(body.prefix(100_000)))"))
			} else {
				parts.append(.file(filename: attachment.filename, dataURL: "data:\(type);base64,\(attachment.dataBase64)"))
			}
		}
		return .user(parts)
	}

	/// Keep the newest history that fits ~60% of the context window,
	/// starting at a user message so tool calls stay paired with results.
	static func compact(_ messages: [Message], contextTokens: Int) -> [Message] {
		let history = messages.filter { $0.role != .system }
		let budget = Int(Double(contextTokens) * 0.6 * 4)
		var used = 0
		var start = history.count
		for index in stride(from: history.count - 1, through: 0, by: -1) {
			let cost = history[index].content.reduce(0) { total, part in
				switch part {
				case let .text(text): total + text.count
				case .image: total + 4000
				case let .file(_, url): total + min(url.count, 200_000)
				}
			} + history[index].toolCalls.reduce(0) { $0 + $1.arguments.count + 50 }
			if used + cost > budget { break }
			used += cost
			start = index
		}
		while start < history.count, history[start].role != .user { start += 1 }
		return Array(history[start...])
	}

	/// 3–6 word session title from the first exchange (fast model).
	static func title(for prompt: String, reply: String, ai: OpenRouterClient) async -> String? {
		guard let result = try? await generateText(TextRequest(
			model: ai.model(ModelDefaults.fast),
			instructions: "Write a 3-6 word title for this conversation. Output only the title, no quotes or trailing punctuation.",
			messages: [.user("User: \(String(prompt.prefix(2000)))\n\nAssistant: \(String(reply.prefix(1000)))")],
			temperature: 0,
			maxOutputTokens: 64,
		)) else { return nil }
		let title = result.text.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\"'“”.")).prefix(80)
		return title.isEmpty ? nil : String(title)
	}
}
