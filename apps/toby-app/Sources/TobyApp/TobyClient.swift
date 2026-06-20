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

	func deleteRecording(id: String) async throws {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/listen/recordings/\(id)"))
		request.httpMethod = "DELETE"
		let (data, response) = try await URLSession.shared.data(for: request)
		try validate(response: response, data: data)
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

	func streamTurn(
		sessionId: String,
		text: String,
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
		request.httpBody = try JSONEncoder().encode(["text": text])

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
				return TurnDonePayload(turnId: nil, text: "", appliedActions: [], sessionName: nil)
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
		return TurnDonePayload(turnId: nil, text: "", appliedActions: [], sessionName: nil)
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
}
