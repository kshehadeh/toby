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

	func streamTurn(
		sessionId: String,
		text: String,
		onEvent: @escaping (ChatEventPayload) -> Void,
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
				return TurnDonePayload(text: "", appliedActions: [], sessionName: nil)
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
		return TurnDonePayload(text: "", appliedActions: [], sessionName: nil)
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
}
