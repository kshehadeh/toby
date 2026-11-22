import Foundation
import TobyAI
import TobyCore

/// In-process `/api/listen/recordings*` (native mode); shapes match the daemon.
struct NativeListenRouter: Sendable {
	let listen: ListenService

	private func run(_ body: () async throws -> JSONValue) async throws -> Data {
		do { return Data(try await body().jsonString().utf8) } catch let error as TodoError { throw TobyClientError.serverError(error.message) }
	}

	func list() async throws -> Data { try await run { listen.listJSON() } }
	func detail(_ id: String) async throws -> Data { try await run { try listen.detail(id: id) } }
	func update(_ id: String, name: String?, chatSessionID: JSONValue?) async throws -> Data {
		try await run { try listen.update(id, name: name, description: nil, chatSessionID: chatSessionID) }
	}
	func delete(_ id: String) async throws { _ = try await run { try listen.delete(id); return ["ok": true] } }
	func deleteAudio(_ id: String) async throws -> Data { try await run { try listen.deleteAudio(id: id) } }
	func summarize(_ id: String) async throws -> Data { try await run { try await listen.summarize(id: id) } }
	func transcribe(_ id: String, reuseLiveTranscript: Bool, onStatus: @escaping @Sendable (String) -> Void) async throws -> Data {
		try await run { try await listen.transcribe(id: id, reuseLiveTranscript: reuseLiveTranscript, onStatus: onStatus) }
	}
}
