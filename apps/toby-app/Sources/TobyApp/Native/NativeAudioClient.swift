import Foundation

enum NativeAudioClientError: LocalizedError {
	case unavailable
	case invalidResponse
	case serverError(String)

	var errorDescription: String? {
		switch self {
		case .unavailable:
			return "Toby native audio server is unavailable."
		case .invalidResponse:
			return "Invalid response from Toby native audio server."
		case .serverError(let message):
			return message
		}
	}
}

@MainActor
struct NativeAudioClient {
	func status() async throws -> ListenStatusResponse {
		try await request("audio/status", method: "GET", body: nil, as: ListenStatusResponse.self)
	}

	func start() async throws -> ListenStatusResponse {
		try await request(
			"audio/start",
			method: "POST",
			body: ["mic": true, "system": true],
			as: ListenStatusResponse.self,
		)
	}

	func stop() async throws -> NativeAudioStopResponse {
		try await request(
			"audio/stop",
			method: "POST",
			body: ["action": "save"],
			as: NativeAudioStopResponse.self,
		)
	}

	private func request<T: Decodable>(
		_ endpoint: String,
		method: String,
		body: [String: Any]?,
		as type: T.Type,
	) async throws -> T {
		guard let port = resolveNativePort(),
			let url = URL(string: "http://127.0.0.1:\(port)/api/native/\(endpoint)")
		else {
			throw NativeAudioClientError.unavailable
		}
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.timeoutInterval = 120
		if let body {
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = try JSONSerialization.data(withJSONObject: body)
		}
		let (data, response) = try await URLSession.shared.data(for: request)
		guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
			throw NativeAudioClientError.invalidResponse
		}
		let envelope = try JSONDecoder().decode(NativeAudioEnvelope<T>.self, from: data)
		guard envelope.ok else {
			throw NativeAudioClientError.serverError(envelope.error ?? "Native audio request failed.")
		}
		guard let data = envelope.data else {
			throw NativeAudioClientError.invalidResponse
		}
		return data
	}

	private func resolveNativePort() -> Int? {
		let portFile = URL(fileURLWithPath: ConfigReader.resolveTobyDir())
			.appendingPathComponent("native-port")
		guard let data = try? Data(contentsOf: portFile),
			let text = String(data: data, encoding: .utf8),
			let port = Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
		else {
			return nil
		}
		return port
	}
}

private struct NativeAudioEnvelope<T: Decodable>: Decodable {
	let ok: Bool
	let data: T?
	let error: String?
}
