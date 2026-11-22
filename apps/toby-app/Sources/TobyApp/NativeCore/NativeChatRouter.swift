import Foundation
import TobyAI
import TobyCore

/// One item from a native chat turn, consumed by `TobyClient.streamTurn`.
enum NativeTurnItem: Sendable {
	case event(Data)
	case askUser(turnID: String, requestID: String, query: String, options: [String], reply: @Sendable (Int, String, String) -> Void)
	case done(Data)
	case failed(String)
}

/// In-process `/api/sessions` (native mode).
struct NativeChatRouter: Sendable {
	let engine: ChatEngine
	let sessions: ChatSessionStore
	let personas: PersonaService
	let projects: ProjectService

	func data(_ value: JSONValue) -> Data { Data(value.jsonString().utf8) }

	func list(limit: Int) throws -> Data {
		data(["sessions": .array(try sessions.list(limit: limit))])
	}

	func create(persona: String?) throws -> Data {
		var settings: [String: JSONValue] = [:]
		if let persona, !persona.isEmpty { settings["persona"] = .string(persona) }
		let session = try sessions.create(name: nil, settings: settings.isEmpty ? nil : .object(settings))
		return data(["id": session["id"] ?? .null, "name": session["name"] ?? .null, "settings": .object(settings)])
	}

	func detail(_ id: String) throws -> Data {
		guard let session = try sessions.load(id) else { throw TobyClientError.serverError("Session not found") }
		let projectPersona = try session.projectID.flatMap { try projects.resolve($0) }?.personaName
		let persona = (session.personaName ?? projectPersona).flatMap(personas.resolve) ?? personas.defaultPersona()
		var object: [String: JSONValue] = [
			"id": .string(session.id), "name": .string(session.name), "transcript": .array(session.transcript),
			"messageCount": .number(Double(session.messages.count)), "settings": session.settings,
			"personaImageUrl": .string("/api/personas/image/\(persona.imagePath ?? "default.png")"),
			"activePlan": .null, "integration": .null, "externalKey": .null,
		]
		if let contextWindow = session.contextWindow { object["contextWindow"] = contextWindow }
		return data(.object(object))
	}

	func delete(_ id: String) throws {
		try sessions.delete(id)
	}

	/// Stream a turn as `NativeTurnItem`s.
	func turn(sessionID: String, text: String, attachments: [ChatEngine.Attachment], turnID: String?) -> AsyncStream<NativeTurnItem> {
		AsyncStream { continuation in
			let task = Task {
				do {
					let done = try await engine.runTurn(
						sessionID: sessionID, text: text, attachments: attachments, turnID: turnID,
						onEvent: { continuation.yield(.event(Data($0.jsonString().utf8))) },
						askUser: { turnID, query, options in
							try await withCheckedThrowingContinuation { reply in
								let once = OnceBox()
								continuation.yield(.askUser(turnID: turnID, requestID: UUID().uuidString.lowercased(), query: query, options: options) { index, label, raw in
									if once.claim() { reply.resume(returning: (index, label, raw)) }
								})
							}
						},
					)
					continuation.yield(.done(Data(done.jsonString().utf8)))
				} catch AIError.cancelled {
					// Like a daemon stream that ends without `done`.
				} catch {
					continuation.yield(.failed((error as? LocalizedError)?.errorDescription ?? String(describing: error)))
				}
				continuation.finish()
			}
			continuation.onTermination = { _ in task.cancel() }
		}
	}

	func cancel(turnID: String) async {
		await engine.cancel(turnID: turnID)
	}
}

/// "First caller wins" flag for one-shot continuations.
final class OnceBox: @unchecked Sendable {
	private let lock = NSLock()
	private var claimed = false
	func claim() -> Bool { lock.withLock { defer { claimed = true }; return !claimed } }
}
