import SwiftUI

struct TranscriptView: View {
	let entries: [TranscriptEntry]
	let streamingAssistant: StreamingAssistantState?

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 12) {
					ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
						TranscriptRow(entry: entry)
					}
					if let streamingAssistant {
						AssistantBox(
							header: streamingAssistant.header,
							messageBody: streamingAssistant.text,
							isStreaming: true,
						)
						.id("streaming")
					}
				}
				.padding(AppTheme.contentPadding)
			}
			.onChange(of: entries.count) { _, _ in
				scrollToBottom(proxy: proxy)
			}
			.onChange(of: streamingAssistant?.text) { _, _ in
				scrollToBottom(proxy: proxy)
			}
		}
	}

	private func scrollToBottom(proxy: ScrollViewProxy) {
		withAnimation(.easeOut(duration: 0.15)) {
			if streamingAssistant != nil {
				proxy.scrollTo("streaming", anchor: .bottom)
			} else if !entries.isEmpty {
				proxy.scrollTo(entries.count - 1, anchor: .bottom)
			}
		}
	}
}

private struct TranscriptRow: View {
	let entry: TranscriptEntry

	var body: some View {
		switch entry {
		case .user(let text):
			UserPromptRow(text: text)
		case .assistant(let text):
			AssistantBox(header: "Assistant", messageBody: text, isStreaming: false)
		case .notice(let text, let tone):
			NoticeRow(text: text, tone: tone)
		case .error(let text):
			NoticeRow(text: text, tone: "error")
		case .boxedStep(let payload):
			if payload.variant == "assistant" {
				AssistantBox(header: payload.header, messageBody: payload.body, isStreaming: false)
			} else if payload.variant == "tool" {
				ToolRow(payload: payload)
			} else if payload.variant == "lifecycle" || payload.variant == "prep" {
				ProcessingRow(payload: payload)
			} else {
				MetaRow(header: payload.header, messageBody: payload.body)
			}
		case .askUserQA(_, let query, let answer, let error):
			VStack(alignment: .leading, spacing: 4) {
				MarkdownText(
					text: query,
					font: .headline,
					foregroundStyle: AppTheme.primaryText,
				)
				if let error {
					MarkdownText(text: error, font: .callout, foregroundStyle: .red)
				} else {
					MarkdownText(
						text: answer,
						font: .callout,
						foregroundStyle: AppTheme.secondaryText,
					)
				}
			}
			.padding(10)
			.background(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
		case .meta(let text), .toolCall(_, let text), .toolOutput(_, let text):
			MarkdownText(
				text: text,
				font: .callout,
				foregroundStyle: AppTheme.secondaryText,
			)
		}
	}
}

private struct UserPromptRow: View {
	let text: String

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Text("▌")
				.foregroundStyle(AppTheme.accent)
				.bold()
			Text(text)
				.font(.title3)
				.bold()
				.foregroundStyle(AppTheme.primaryText)
				.textSelection(.enabled)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

private struct AssistantBox: View {
	let header: String
	let messageBody: String
	let isStreaming: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text(header)
				.font(.headline)
				.foregroundStyle(AppTheme.secondaryText)
			MarkdownText(
				text: messageBody,
				font: .title3,
				foregroundStyle: AppTheme.primaryText,
			)
			if isStreaming {
				ProgressView()
					.controlSize(.small)
			}
		}
		.padding(.horizontal, 18)
		.padding(.vertical, 16)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.fill(AppTheme.panelBackground),
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.stroke(AppTheme.separator),
		)
	}
}

private struct ToolRow: View {
	let payload: BoxedStepPayload

	var body: some View {
		MiniTranscriptCard(
			systemImage: payload.cacheHit == true ? "checkmark.circle" : "wrench.and.screwdriver",
			title: payload.header,
			subtitle: payload.toolName,
			detail: payload.body,
			tint: AppTheme.secondaryText,
			bodyStyle: .nested,
		)
	}
}

private struct ProcessingRow: View {
	let payload: BoxedStepPayload

	var body: some View {
		MiniTranscriptCard(
			systemImage: payload.body == "Thinking" ? "brain.head.profile" : "checkmark",
			title: payload.header,
			subtitle: nil,
			detail: payload.body,
			tint: AppTheme.tertiaryText,
			bodyStyle: payload.body == "Thinking" ? .plain : .nested,
		)
	}
}

private struct NoticeRow: View {
	let text: String
	let tone: String?

	var body: some View {
		MarkdownText(text: text, font: .callout, foregroundStyle: color)
			.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var color: Color {
		switch tone {
		case "success":
			return .green
		case "error":
			return .red
		default:
			return .secondary
		}
	}
}

private struct MetaRow: View {
	let header: String
	let messageBody: String

	var body: some View {
		MiniTranscriptCard(
			systemImage: "info.circle",
			title: header,
			subtitle: nil,
			detail: messageBody,
			tint: AppTheme.secondaryText,
			bodyStyle: .nested,
		)
	}
}

private enum MiniTranscriptBodyStyle {
	case plain
	case nested
}

private struct MiniTranscriptCard: View {
	let systemImage: String
	let title: String
	let subtitle: String?
	let detail: String
	let tint: Color
	let bodyStyle: MiniTranscriptBodyStyle

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			HStack(alignment: .firstTextBaseline, spacing: 10) {
				Image(systemName: systemImage)
					.foregroundStyle(tint)
					.frame(width: 18)
				Text(title)
					.font(.headline)
					.foregroundStyle(AppTheme.primaryText)
				if let subtitle, !subtitle.isEmpty {
					Text(subtitle)
						.font(.callout)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				Spacer(minLength: 0)
			}
			if !detail.isEmpty {
				MiniTranscriptCardBody(text: detail, style: bodyStyle)
					.padding(.leading, 28)
			}
		}
		.padding(.horizontal, 14)
		.padding(.vertical, 12)
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

private struct MiniTranscriptCardBody: View {
	let text: String
	let style: MiniTranscriptBodyStyle

	var body: some View {
		MarkdownText(
			text: text,
			font: .callout,
			foregroundStyle: AppTheme.secondaryText,
		)
			.padding(style == .nested ? 10 : 0)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background {
				if style == .nested {
					RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
						.fill(AppTheme.elevatedBackground)
				}
			}
	}
}
