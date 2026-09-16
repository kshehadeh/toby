import SwiftUI

struct TranscriptRow: View {
	let entry: TranscriptEntry

	var body: some View {
		switch entry {
		case .user(let text, let attachments, let createdAt):
			UserMessageRow(text: text, attachments: attachments, createdAt: createdAt)
		case .assistant(let text, let createdAt):
			AssistantMessageRow(
				messageBody: text,
				isStreaming: false,
				createdAt: createdAt,
			)
		case .notice(let text, let tone):
			NoticeRow(text: text, tone: tone)
		case .error(let text):
			NoticeRow(text: text, tone: "error")
		case .boxedStep(let payload):
			// Final and interim assistant segments both render as conversation rows
			// (interim only reaches here in normal transcript mode).
			if payload.variant == "assistant" || payload.variant == "assistant_interim" {
				AssistantMessageRow(
					messageBody: payload.body,
					isStreaming: false,
					createdAt: payload.createdAt,
				)
			} else {
				EmptyView()
			}
		case .askUserQA(_, let query, let answer, let error):
			AskUserQARow(query: query, answer: answer, error: error)
		case .meta, .toolCall, .toolOutput, .turnWork:
			EmptyView()
		}
	}
}
