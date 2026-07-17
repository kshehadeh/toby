import AppKit
import SwiftUI

struct TranscriptRow: View {
	let entry: TranscriptEntry
	var personaImage: URL?

	var body: some View {
		switch entry {
		case .user(let text, let attachments):
			UserMessageRow(text: text, attachments: attachments)
		case .assistant(let text):
			AssistantMessageRow(
				iconName: "sparkle",
				header: "Assistant",
				messageBody: text,
				isStreaming: false,
				personaImage: personaImage,
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
					iconName: "sparkle",
					header: payload.header,
					messageBody: payload.body,
					isStreaming: false,
					personaImage: personaImage,
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
