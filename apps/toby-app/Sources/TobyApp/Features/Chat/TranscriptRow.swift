import AppKit
import SwiftUI

struct TranscriptRow: View {
	let entry: TranscriptEntry
	var personaImage: URL?

	var body: some View {
		switch entry {
		case .user(let text):
			UserMessageRow(text: text)
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
			if payload.variant == "assistant" {
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
