import Foundation

enum NativeAudioClientError: LocalizedError {
	case unavailable
	case invalidResponse
	case serverError(String)

	var errorDescription: String? {
		switch self {
		case .unavailable:
			return "Audio recording is unavailable."
		case .invalidResponse:
			return "Invalid response from audio recording."
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

	func start(mic: Bool = true, system: Bool = true) async throws -> ListenStatusResponse {
		var micOn = mic
		var systemOn = system
		if !micOn && !systemOn {
			micOn = true
			systemOn = true
		}
		return try await request(
			"audio/start",
			method: "POST",
			body: ["mic": micOn, "system": systemOn],
			as: ListenStatusResponse.self,
			timeout: 0,
		)
	}

	func stop() async throws -> NativeAudioStopResponse {
		try await request(
			"audio/stop",
			method: "POST",
			body: ["action": "save"],
			as: NativeAudioStopResponse.self,
			// Combine + m4a export for a long dual-source take can exceed minutes.
			// 0 means the request does not time out.
			timeout: 0,
		)
	}

	private func request<T: Decodable>(
		_ endpoint: String,
		method: String,
		body: [String: Any]?,
		as type: T.Type,
		timeout: TimeInterval = 120,
	) async throws -> T {
		let payload = try body.map { try JSONSerialization.data(withJSONObject: $0) }
		let data = await NativeDispatcher.shared.dispatch(endpoint: endpoint, body: payload, method: method)
		let envelope = try JSONDecoder().decode(NativeAudioEnvelope<T>.self, from: data)
		guard envelope.ok else {
			throw NativeAudioClientError.serverError(envelope.error ?? "Native audio request failed.")
		}
		guard let data = envelope.data else {
			throw NativeAudioClientError.invalidResponse
		}
		return data
	}
}

private struct NativeAudioEnvelope<T: Decodable>: Decodable {
	let ok: Bool
	let data: T?
	let error: String?
}
