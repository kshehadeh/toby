import Foundation

enum TobyClientError: LocalizedError {
	case invalidResponse
	case serverError(String)
	case streamError(String)

	var errorDescription: String? {
		switch self {
		case .invalidResponse:
			return "Invalid response from Toby daemon."
		case .serverError(let message):
			return message
		case .streamError(let message):
			return message
		}
	}
}

@MainActor
struct TobyClient {
	let baseURL: URL

	init(baseURL: URL = ConfigReader.baseURL()) {
		self.baseURL = baseURL
	}

	func fetchStatus() async throws -> AppStatus {
		let url = baseURL.appendingPathComponent("api/status")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(AppStatus.self, from: data)
	}

	func fetchDaemonStatus() async throws -> DaemonStatus {
		let url = baseURL.appendingPathComponent("api/daemon/status")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(DaemonStatus.self, from: data)
	}

	func restartDaemon() async throws {
		try await DaemonBootstrap.restartServer(baseURL: baseURL)
	}

	func listSessions(limit: Int = 20) async throws -> [SessionSummary] {
		var components = URLComponents(
			url: baseURL.appendingPathComponent("api/sessions"),
			resolvingAgainstBaseURL: false,
		)!
		components.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
		let (data, response) = try await URLSession.shared.data(from: components.url!)
		try validate(response: response, data: data)
		struct Payload: Decodable { let sessions: [SessionSummary] }
		return try JSONDecoder().decode(Payload.self, from: data).sessions
	}

	func listPersonas() async throws -> [PersonaOption] {
		let url = baseURL.appendingPathComponent("api/personas")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		struct Payload: Decodable { let personas: [PersonaOption] }
		return try JSONDecoder().decode(Payload.self, from: data).personas
	}

	func fetchPersonaDetail(name: String) async throws -> PersonaDetail {
		let encoded = name.addingPercentEncoding(
			withAllowedCharacters: .urlPathAllowed,
		) ?? name
		let url = baseURL.appendingPathComponent("api/personas/\(encoded)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(PersonaDetailResponse.self, from: data).persona
	}

	func fetchAIProviders() async throws -> [AIProviderInfo] {
		let url = baseURL.appendingPathComponent("api/ai/providers")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(AIProvidersResponse.self, from: data).providers
	}

	func createPersona(
		name: String,
		instructions: String,
		provider: String,
		model: String,
		promptMode: String,
	) async throws -> ConfigureActionResponse {
		try await runConfigureAction(
			"create-persona",
			body: [
				"name": name,
				"instructions": instructions,
				"provider": provider,
				"model": model,
				"promptMode": promptMode,
			],
		)
	}

	func updatePersona(
		originalName: String,
		name: String?,
		instructions: String?,
		provider: String?,
		model: String?,
		promptMode: String?,
	) async throws -> ConfigureActionResponse {
		var body: [String: String] = ["originalName": originalName]
		if let name { body["name"] = name }
		if let instructions { body["instructions"] = instructions }
		if let provider { body["provider"] = provider }
		if let model { body["model"] = model }
		if let promptMode { body["promptMode"] = promptMode }
		return try await runConfigureAction("update-persona", body: body)
	}

	func fetchSession(id: String) async throws -> SessionDetail {
		let url = baseURL.appendingPathComponent("api/sessions/\(id)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(SessionDetail.self, from: data)
	}

	func createSession() async throws -> CreateSessionResponse {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/sessions"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(CreateSessionResponse.self, from: data)
	}

	func deleteSession(id: String) async throws {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/sessions/\(id)"))
		request.httpMethod = "DELETE"
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
	}

	func fetchListenStatus() async throws -> ListenStatusResponse {
		let url = baseURL.appendingPathComponent("api/listen/status")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenStatusResponse.self, from: data)
	}

	func startListening() async throws -> ListenStatusResponse {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/start"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenStatusResponse.self, from: data)
	}

	func stopListening() async throws -> ListenStopResponse {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/stop"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenStopResponse.self, from: data)
	}

	func listRecordings() async throws -> [ListenRecordingSummary] {
		let url = baseURL.appendingPathComponent("api/listen/recordings")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenRecordingsListResponse.self, from: data).recordings
	}

	func fetchRecording(id: String) async throws -> ListenRecordingDetail {
		let url = baseURL.appendingPathComponent("api/listen/recordings/\(id)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenRecordingDetail.self, from: data)
	}

	func updateRecording(id: String, name: String?) async throws -> ListenRecordingDetail {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/recordings/\(id)"))
		request.httpMethod = "PATCH"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		var body: [String: Any] = [:]
		if let name { body["name"] = name }
		request.httpBody = try JSONSerialization.data(withJSONObject: body)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenRecordingDetail.self, from: data)
	}

	func updateRecordingChatSession(id: String, chatSessionId: String?) async throws -> ListenRecordingDetail {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/recordings/\(id)"))
		request.httpMethod = "PATCH"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		var body: [String: Any] = [:]
		if let chatSessionId {
			body["chatSessionId"] = chatSessionId
		} else {
			body["chatSessionId"] = NSNull()
		}
		request.httpBody = try JSONSerialization.data(withJSONObject: body)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenRecordingDetail.self, from: data)
	}

	func deleteRecording(id: String) async throws {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/recordings/\(id)"))
		request.httpMethod = "DELETE"
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
	}

	func parseCronExpression(input: String) async throws -> String {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/schedules/parse-cron"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONEncoder().encode(["input": input])
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		struct Payload: Decodable { let cronExpression: String }
		return try JSONDecoder().decode(Payload.self, from: data).cronExpression
	}

	func transcribeRecording(id: String) async throws -> ListenRecordingDetail {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/recordings/\(id)/transcribe"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenRecordingDetail.self, from: data)
	}

	func streamTranscribeRecording(
		id: String,
		onStatus: @escaping (String) -> Void,
	) async throws -> ListenRecordingDetail {
		let url = baseURL.appendingPathComponent("api/listen/recordings/\(id)/transcribe")
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
		request.httpBody = Data("{}".utf8)

		let (bytes, response) = try await URLSession.shared.bytes(for: request)
		guard let http = response as? HTTPURLResponse else {
			throw TobyClientError.invalidResponse
		}
		if http.statusCode >= 400 {
			var data = Data()
			for try await byte in bytes {
				data.append(byte)
			}
			if
				let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let error = json["error"] as? String
			{
				throw TobyClientError.serverError(error)
			}
			throw TobyClientError.serverError("HTTP \(http.statusCode)")
		}

		var pendingEvent: String?
		for try await line in bytes.lines {
			if line.hasPrefix("event: ") {
				pendingEvent = String(line.dropFirst(7))
					.trimmingCharacters(in: .whitespacesAndNewlines)
				continue
			}
			guard line.hasPrefix("data: ") else { continue }
			let payload = String(line.dropFirst(6))
			if payload.isEmpty { continue }

			if pendingEvent == "status" {
				pendingEvent = nil
				if let data = payload.data(using: .utf8),
					let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
					let message = json["message"] as? String
				{
					onStatus(message)
				}
				continue
			}

			if pendingEvent == "done" {
				pendingEvent = nil
				if let data = payload.data(using: .utf8) {
					if let detail = try? JSONDecoder().decode(ListenRecordingDetail.self, from: data) {
						return detail
					}
				}
				throw TobyClientError.streamError("Transcription completed but response was invalid.")
			}

			if pendingEvent == "error" {
				pendingEvent = nil
				if
					let data = payload.data(using: .utf8),
					let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
					let error = json["error"] as? String
				{
					throw TobyClientError.streamError(error)
				}
				throw TobyClientError.streamError("Transcription failed.")
			}

			pendingEvent = nil
		}

		// Stream ended without an explicit done event. The transcription may
		// have completed on the backend despite the stream closing early.
		// Fall back to fetching the recording detail directly.
		return try await fetchRecordingDetailFallback(id: id)
	}

	/// Fallback: fetch the recording detail after the SSE stream completes
	/// without an explicit done event. The transcription may have succeeded
	/// on the backend even if the stream closed before the final event was
	/// read by `URLSession.bytes.lines`.
	private func fetchRecordingDetailFallback(id: String) async throws -> ListenRecordingDetail {
		let url = baseURL.appendingPathComponent("api/listen/recordings/\(id)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ListenRecordingDetail.self, from: data)
	}

	func streamTurn(
		sessionId: String,
		text: String,
		clientTurnId: String? = nil,
		onEvent: @escaping (ChatEventPayload) -> Void,
		onAskUser: ((AskUserPromptPayload) async -> (selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?))?,
	) async throws -> TurnDonePayload {
		let turnURL = baseURL.appendingPathComponent("api/sessions/\(sessionId)/turn")
		ServerEventLog.beginTurn(sessionId: sessionId, text: text, url: turnURL)
		defer { ServerEventLog.endTurn() }

		var request = URLRequest(
			url: turnURL,
		)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		var bodyDict: [String: String] = ["text": text]
		if let clientTurnId {
			bodyDict["clientTurnId"] = clientTurnId
		}
		request.httpBody = try JSONEncoder().encode(bodyDict)

		let (bytes, response) = try await URLSession.shared.bytes(for: request)
		guard let http = response as? HTTPURLResponse else {
			ServerEventLog.append("response.invalid")
			throw TobyClientError.invalidResponse
		}
		ServerEventLog.append("response.status=\(http.statusCode)")
		if http.statusCode >= 400 {
			var data = Data()
			for try await byte in bytes {
				data.append(byte)
			}
			ServerEventLog.append("response.errorBody=\(String(data: data, encoding: .utf8) ?? "<non-utf8>")")
			if
				let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let error = json["error"] as? String
			{
				throw TobyClientError.serverError(error)
			}
			throw TobyClientError.serverError("HTTP \(http.statusCode)")
		}

		var pendingEvent: String?
		for try await line in bytes.lines {
			ServerEventLog.append("sse.raw=\(line)")
			if line.hasPrefix("event: ") {
				pendingEvent = String(line.dropFirst(7))
					.trimmingCharacters(in: .whitespacesAndNewlines)
				ServerEventLog.append("sse.event=\(pendingEvent ?? "")")
				continue
			}
			guard line.hasPrefix("data: ") else { continue }
			let payload = String(line.dropFirst(6))
			if payload.isEmpty { continue }
			ServerEventLog.append("sse.data.event=\(pendingEvent ?? "message") payload=\(payload)")

			if pendingEvent == "done" {
				pendingEvent = nil
				if let data = payload.data(using: .utf8) {
					if let done = try? JSONDecoder().decode(TurnDonePayload.self, from: data) {
						ServerEventLog.append(
							"sse.done.decoded text.count=\(done.text.count) text=\(done.text)",
						)
						return done
					}
				}
				ServerEventLog.append("sse.done.decodeFailed payload=\(payload)")
				return TurnDonePayload(turnId: nil, text: "", appliedActions: [], sessionName: nil, usage: nil, contextWindow: nil)
			}

			if pendingEvent == "ask_user_prompt" {
				pendingEvent = nil
				if let data = payload.data(using: .utf8),
					let prompt = try? JSONDecoder().decode(AskUserPromptPayload.self, from: data),
					let onAskUser
				{
					let answer = await onAskUser(prompt)
					try await answerAskUser(
						sessionId: sessionId,
						turnId: prompt.turnId,
						requestId: prompt.requestId,
						selectedIndex: answer.selectedIndex,
						selectedLabel: answer.selectedLabel,
						rawInput: answer.rawInput,
						error: answer.error,
					)
				}
				continue
			}

			if pendingEvent == "error" {
				pendingEvent = nil
				if
					let data = payload.data(using: .utf8),
					let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
					let error = json["error"] as? String
				{
					throw TobyClientError.streamError(error)
				}
				throw TobyClientError.streamError("Turn failed.")
			}

			pendingEvent = nil
			if let data = payload.data(using: .utf8),
				let event = try? JSONDecoder().decode(ChatEventPayload.self, from: data)
			{
				ServerEventLog.append("sse.message.decoded type=\(event.type)")
				onEvent(event)
			} else {
				ServerEventLog.append("sse.message.decodeFailed payload=\(payload)")
			}
		}

		ServerEventLog.append("sse.streamEndedWithoutDone")
		return TurnDonePayload(turnId: nil, text: "", appliedActions: [], sessionName: nil, usage: nil, contextWindow: nil)
	}

	func cancelTurn(sessionId: String, turnId: String) async {
		let url = baseURL.appendingPathComponent(
			"api/sessions/\(sessionId)/turn/\(turnId)/cancel"
		)
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		_ = try? await URLSession.shared.data(for: request)
	}

	func answerAskUser(
		sessionId: String,
		turnId: String,
		requestId: String,
		selectedIndex: Int,
		selectedLabel: String,
		rawInput: String,
		error: String? = nil,
	) async throws {
		let url = baseURL.appendingPathComponent(
			"api/sessions/\(sessionId)/turn/\(turnId)/ask-user/\(requestId)",
		)
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		var body: [String: Any] = [
			"selectedIndex": selectedIndex,
			"selectedLabel": selectedLabel,
			"rawInput": rawInput,
		]
		if let error {
			body["error"] = error
		}
		request.httpBody = try JSONSerialization.data(withJSONObject: body)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
	}

	private func validate(response: URLResponse, data: Data) throws {
		guard let http = response as? HTTPURLResponse else {
			throw TobyClientError.invalidResponse
		}
		guard (200 ... 299).contains(http.statusCode) else {
			if
				let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let error = json["error"] as? String
			{
				throw TobyClientError.serverError(error)
			}
			throw TobyClientError.serverError("HTTP \(http.statusCode)")
		}
	}

	func createIssue(type: String, details: String) async throws -> CreateIssueResponse {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/issues"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		let body: [String: Any] = [
			"type": type,
			"details": details,
			"source": "native-app",
		]
		request.httpBody = try JSONSerialization.data(withJSONObject: body)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(CreateIssueResponse.self, from: data)
	}

	func fetchConfigureTree() async throws -> ConfigureTreeResponse {
		let url = baseURL.appendingPathComponent("api/configure/tree")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ConfigureTreeResponse.self, from: data)
	}

	func fetchConfigureSections() async throws -> ConfigureSectionsResponse {
		let url = baseURL.appendingPathComponent("api/configure/sections")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ConfigureSectionsResponse.self, from: data)
	}

	func fetchConfigureSectionDetail(sectionKey: String) async throws -> ConfigureSectionDetailResponse {
		let encoded = sectionKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sectionKey
		let url = baseURL.appendingPathComponent("api/configure/sections/\(encoded)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ConfigureSectionDetailResponse.self, from: data)
	}

	func patchConfigure(changes: [String: String]) async throws -> ConfigureTreeResponse {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/configure/values"))
		request.httpMethod = "PATCH"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONEncoder().encode(["changes": changes])
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ConfigureTreeResponse.self, from: data)
	}

	func runConfigureAction(
		_ action: String,
		body: [String: String],
	) async throws -> ConfigureActionResponse {
		let url = baseURL.appendingPathComponent("api/configure/actions/\(action)")
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = try JSONEncoder().encode(body)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ConfigureActionResponse.self, from: data)
	}

	func fetchIntegrationStatus(name: String) async throws -> IntegrationStatus {
		let url = baseURL.appendingPathComponent("api/integrations/\(name)/status")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(IntegrationStatus.self, from: data)
	}

	func runIntegrationAction(
		name: String,
		action: IntegrationAction,
	) async throws -> IntegrationActionResponse {
		let url = baseURL.appendingPathComponent("api/integrations/\(name)/\(action.rawValue)")
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(IntegrationActionResponse.self, from: data)
	}

	func fetchIntegrationSetupGuide(name: String) async throws -> IntegrationSetupGuide {
		let url = baseURL.appendingPathComponent("api/integrations/\(name)/setup-guide")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(IntegrationSetupGuide.self, from: data)
	}

	func listSkills() async throws -> [SkillListItem] {
		let url = baseURL.appendingPathComponent("api/skills")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		struct Payload: Decodable { let skills: [SkillListItem] }
		return try JSONDecoder().decode(Payload.self, from: data).skills
	}

	func fetchSkill(dirName: String) async throws -> SkillDetail {
		let url = baseURL.appendingPathComponent("api/skills/\(dirName)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		struct Payload: Decodable { let skill: SkillDetail }
		return try JSONDecoder().decode(Payload.self, from: data).skill
	}

	func fetchScheduleRun(id: String) async throws -> ScheduleRunDetail {
		let url = baseURL.appendingPathComponent("api/schedules/runs/\(id)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		struct Payload: Decodable { let run: ScheduleRunDetail }
		return try JSONDecoder().decode(Payload.self, from: data).run
	}

	func fetchChangelog(limit: Int = 10) async throws -> ChangelogResponse {
		var components = URLComponents(
			url: baseURL.appendingPathComponent("api/releases/changelog"),
			resolvingAgainstBaseURL: false,
		)!
		components.queryItems = [URLQueryItem(name: "limit", value: String(max(1, min(limit, 10))))]
		let (data, response) = try await URLSession.shared.data(from: components.url!)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(ChangelogResponse.self, from: data)
	}
	func fetchPlugins() async throws -> PluginsListResponse {
		let url = baseURL.appendingPathComponent("api/plugins")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(PluginsListResponse.self, from: data)
	}

	// MARK: - Memories

	func listMemories(limit: Int = 50, offset: Int = 0, query: String? = nil) async throws -> MemoriesListResponse {
		var components = URLComponents(
			url: baseURL.appendingPathComponent("api/memories"),
			resolvingAgainstBaseURL: false,
		)!
		var items = [
			URLQueryItem(name: "limit", value: String(limit)),
			URLQueryItem(name: "offset", value: String(offset)),
		]
		if let query, !query.isEmpty {
			items.append(URLQueryItem(name: "q", value: query))
		}
		components.queryItems = items
		let (data, response) = try await URLSession.shared.data(from: components.url!)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(MemoriesListResponse.self, from: data)
	}

	func fetchMemory(id: String) async throws -> MemoryItem {
		let url = baseURL.appendingPathComponent("api/memories/\(id)")
		let (data, response) = try await URLSession.shared.data(from: url)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(MemoryDetailResponse.self, from: data).memory
	}

	func createMemory(_ request: MemoryCreateRequest) async throws -> MemoryItem {
		var urlRequest = URLRequest(url: baseURL.appendingPathComponent("api/memories"))
		urlRequest.httpMethod = "POST"
		urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
		urlRequest.httpBody = try JSONEncoder().encode(request)
		let (data, response) = try await URLSession.shared.data(for: urlRequest)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(MemoryDetailResponse.self, from: data).memory
	}

	func patchMemory(id: String, patch: MemoryPatchRequest) async throws -> MemoryItem {
		var urlRequest = URLRequest(url: baseURL.appendingPathComponent("api/memories/\(id)"))
		urlRequest.httpMethod = "PATCH"
		urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
		urlRequest.httpBody = try JSONEncoder().encode(patch)
		let (data, response) = try await URLSession.shared.data(for: urlRequest)
		try validate(response: response, data: data)
		return try JSONDecoder().decode(MemoryDetailResponse.self, from: data).memory
	}

	func deleteMemory(id: String) async throws {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/memories/\(id)"))
		request.httpMethod = "DELETE"
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
	}
}
