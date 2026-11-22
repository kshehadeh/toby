import Foundation
import TobyCore

extension TobyClient {
	/// Native-mode counterpart of the SSE turn stream: same callbacks, same payloads.
	func streamNativeTurn(
		sessionId: String,
		text: String,
		attachments: [ChatAttachmentDraft],
		clientTurnId: String?,
		onEvent: @escaping (ChatEventPayload) -> Void,
		onAskUser: ((AskUserPromptPayload) async -> (selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?))?,
		onPosted: (@MainActor () -> Void)?,
	) async throws -> TurnDonePayload {
		let router = try await NativeRuntime.shared.chat()
		let files = attachments.map { ChatEngine.Attachment(filename: $0.filename, mediaType: $0.mediaType, dataBase64: $0.dataBase64, byteSize: $0.byteSize) }
		let stream = router.turn(sessionID: sessionId, text: text, attachments: files, turnID: clientTurnId)
		await onPosted?()
		let decoder = JSONDecoder()
		for await item in stream {
			switch item {
			case let .event(data):
				if let event = try? decoder.decode(ChatEventPayload.self, from: data) { onEvent(event) }
			case let .askUser(turnID, requestID, query, options, reply):
				let prompt = AskUserPromptPayload(turnId: turnID, requestId: requestID, query: query, options: options)
				if let onAskUser {
					let answer = await onAskUser(prompt)
					reply(answer.selectedIndex, answer.selectedLabel, answer.rawInput)
				} else {
					reply(-1, "", "")
				}
			case let .done(data):
				return (try? decoder.decode(TurnDonePayload.self, from: data))
					?? TurnDonePayload(turnId: clientTurnId, text: "", appliedActions: [], sessionName: nil, usage: nil, contextWindow: nil)
			case let .failed(message):
				throw TobyClientError.serverError(message)
			}
		}
		return TurnDonePayload(turnId: clientTurnId, text: "", appliedActions: [], sessionName: nil, usage: nil, contextWindow: nil)
	}
}
