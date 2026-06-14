import AppKit
import SwiftUI

struct TranscriptView: View {
	let entries: [TranscriptEntry]
	let streamingAssistant: StreamingAssistantState?
	var isLoading = false
	var turnWorkDurations: [Int: TimeInterval] = [:]
	var activeWorkStartDate: Date?

	@State private var expandedWorkGroups: Set<String> = []
	@State private var collapsedWhileActive: Set<String> = []

	private var displayItems: [TranscriptDisplayItem] {
		TranscriptGrouping.groupedItems(from: entries, isLoading: isLoading)
	}

	private func isWorkGroupExpanded(_ group: TranscriptWorkGroup) -> Bool {
		if group.isActive {
			return !collapsedWhileActive.contains(group.id)
		}
		return expandedWorkGroups.contains(group.id)
	}

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 12) {
					ForEach(displayItems) { item in
						switch item {
						case .entry(let entry, _):
							TranscriptRow(entry: entry)
						case .workGroup(let group):
							WorkedForRow(
								group: group,
								duration: duration(for: group),
								activeWorkStartDate: group.isActive ? activeWorkStartDate : nil,
								isExpanded: isWorkGroupExpanded(group),
								onToggle: { toggleWorkGroup(group) },
								streamingAssistant: group.isActive && streamingAssistant?.inWorkArea == true
									? streamingAssistant
									: nil,
							)
							.id(group.id)
						}
					}
					if let streamingAssistant, !streamingAssistant.inWorkArea {
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
			.onChange(of: isLoading) { wasLoading, loading in
				if wasLoading, !loading {
					withAnimation(.easeOut(duration: 0.2)) {
						collapsedWhileActive.removeAll()
						for item in displayItems {
							if case .workGroup(let group) = item {
								expandedWorkGroups.remove(group.id)
							}
						}
					}
				}
			}
		}
	}

	private func duration(for group: TranscriptWorkGroup) -> TimeInterval? {
		if group.isActive, let started = activeWorkStartDate {
			return Date().timeIntervalSince(started)
		}
		if let durationMs = group.durationMs {
			return TimeInterval(durationMs) / 1000.0
		}
		guard let index = group.userTurnIndex else { return nil }
		return turnWorkDurations[index]
	}

	private func toggleWorkGroup(_ group: TranscriptWorkGroup) {
		if group.isActive {
			if collapsedWhileActive.contains(group.id) {
				collapsedWhileActive.remove(group.id)
			} else {
				collapsedWhileActive.insert(group.id)
			}
			return
		}
		if expandedWorkGroups.contains(group.id) {
			expandedWorkGroups.remove(group.id)
		} else {
			expandedWorkGroups.insert(group.id)
		}
	}

	private func scrollToBottom(proxy: ScrollViewProxy) {
		withAnimation(.easeOut(duration: 0.15)) {
			if streamingAssistant != nil {
				proxy.scrollTo("streaming", anchor: .bottom)
			} else if let last = displayItems.last {
				proxy.scrollTo(last.id, anchor: .bottom)
			}
		}
	}
}

private struct WorkedForRow: View {
	let group: TranscriptWorkGroup
	let duration: TimeInterval?
	let activeWorkStartDate: Date?
	let isExpanded: Bool
	let onToggle: () -> Void
	var streamingAssistant: StreamingAssistantState?

	var body: some View {
		TimelineView(.periodic(from: .now, by: 1.0)) { context in
			VStack(alignment: .leading, spacing: 0) {
				Button(action: onToggle) {
					HStack(spacing: 8) {
						if group.isActive {
							ProgressView()
								.controlSize(.small)
						}
						Text(summaryLabel(at: context.date))
							.font(.subheadline)
							.foregroundStyle(AppTheme.secondaryText)
						Spacer(minLength: 0)
						Image(systemName: "chevron.right")
							.font(.caption.weight(.semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.rotationEffect(.degrees(isExpanded ? 90 : 0))
					}
					.padding(.vertical, 8)
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)

				if isExpanded {
					VStack(alignment: .leading, spacing: 8) {
						ForEach(Array(group.entries.enumerated()), id: \.offset) { _, entry in
							WorkDetailRow(entry: entry)
						}
						if let streamingAssistant {
							InterimAssistantRow(
								header: streamingAssistant.header,
								messageBody: streamingAssistant.text,
								isStreaming: true,
							)
						}
					}
					.padding(.bottom, 10)
					.transition(.opacity.combined(with: .move(edge: .top)))
				}

				Rectangle()
					.fill(AppTheme.separator)
					.frame(height: 1)
			}
			.animation(.easeOut(duration: 0.2), value: isExpanded)
		}
	}

	private func summaryLabel(at date: Date) -> String {
		let elapsed = liveDuration(at: date)
		if group.isActive {
			if let elapsed {
				return "Working for \(formatSeconds(elapsed))…"
			}
			return "Working…"
		}
		if let elapsed {
			return "Worked for \(formatSeconds(elapsed))"
		}
		return "Worked"
	}

	private func liveDuration(at date: Date) -> TimeInterval? {
		if group.isActive, let started = activeWorkStartDate {
			return date.timeIntervalSince(started)
		}
		if let durationMs = group.durationMs {
			return TimeInterval(durationMs) / 1000.0
		}
		return duration
	}

	private func formatSeconds(_ interval: TimeInterval) -> String {
		let seconds = max(1, Int(interval.rounded()))
		return seconds == 1 ? "1s" : "\(seconds)s"
	}
}

private struct WorkDetailRow: View {
	let entry: TranscriptEntry

	var body: some View {
		switch entry {
		case .boxedStep(let payload):
			if payload.variant == "lifecycle",
				TranscriptGrouping.isHiddenLifecycleHeader(payload.header)
			{
				EmptyView()
			} else if payload.variant == "assistant_interim" {
				InterimAssistantRow(
					header: payload.header,
					messageBody: payload.body,
					isStreaming: false,
				)
			} else {
				HStack(alignment: .top, spacing: 8) {
				Image(systemName: iconName(for: payload))
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.frame(width: 14, alignment: .center)
					.padding(.top, 2)
				VStack(alignment: .leading, spacing: 2) {
					Text(payload.header)
						.font(.caption.weight(.medium))
						.foregroundStyle(AppTheme.secondaryText)
					if !payload.body.isEmpty {
						Text(payload.body)
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.lineLimit(4)
					}
				}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.leading, 4)
			}
		case .toolCall(_, let title):
			WorkDetailLine(systemImage: "wrench.and.screwdriver", text: title)
		case .toolOutput(_, let detail):
			WorkDetailLine(systemImage: "text.alignleft", text: detail)
		case .meta(let text):
			WorkDetailLine(systemImage: "info.circle", text: text)
		default:
			EmptyView()
		}
	}

	private func iconName(for payload: BoxedStepPayload) -> String {
		switch payload.variant {
		case "tool":
			return payload.cacheHit == true ? "checkmark.circle" : "wrench.and.screwdriver"
		case "lifecycle", "prep":
			return payload.body == "Thinking" ? "brain.head.profile" : "checkmark"
		case "assistant_interim":
			return "text.bubble"
		default:
			return "circle"
		}
	}
}

private struct InterimAssistantRow: View {
	let header: String
	let messageBody: String
	let isStreaming: Bool

	var body: some View {
		HStack(alignment: .top, spacing: 6) {
			Image(systemName: "text.bubble")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 14, alignment: .center)
				.padding(.top, 2)
			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 6) {
					Text(header)
						.font(.caption.weight(.semibold))
						.foregroundStyle(AppTheme.secondaryText)
					if isStreaming {
						ProgressView()
							.controlSize(.mini)
					}
				}
				if !messageBody.isEmpty {
					MarkdownText(
						text: messageBody,
						font: .callout,
						foregroundStyle: AppTheme.tertiaryText,
					)
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.vertical, 4)
		.padding(.leading, 4)
	}
}

private struct WorkDetailLine: View {
	let systemImage: String
	let text: String

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: systemImage)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 14, alignment: .center)
				.padding(.top, 2)
			Text(text)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(4)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.leading, 4)
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
			} else if payload.variant == "assistant_interim" {
				EmptyView()
			} else {
				EmptyView()
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
		case .meta, .toolCall, .toolOutput, .turnWork:
			EmptyView()
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
			} else if !messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				HStack {
					CopyResponseButton(text: messageBody)
					Spacer(minLength: 0)
				}
				.padding(.top, 4)
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

private struct CopyResponseButton: View {
	let text: String
	@State private var didCopy = false

	var body: some View {
		Button {
			copyToClipboard()
		} label: {
			Image(systemName: didCopy ? "checkmark" : "square.on.square")
				.font(.caption)
		}
		.buttonStyle(.plain)
		.foregroundStyle(didCopy ? AppTheme.accent : AppTheme.tertiaryText)
		.help(didCopy ? "Copied" : "Copy response")
		.accessibilityLabel(didCopy ? "Copied" : "Copy response")
	}

	private func copyToClipboard() {
		let pasteboard = NSPasteboard.general
		pasteboard.clearContents()
		pasteboard.setString(text, forType: .string)
		didCopy = true
		DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
			didCopy = false
		}
	}
}

private struct NoticeRow: View {
	let text: String
	let tone: String?

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: iconName)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 14, alignment: .center)
				.padding(.top, 2)
			MarkdownText(text: text, font: .callout, foregroundStyle: color)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.vertical, 2)
	}

	private var iconName: String {
		if text.hasPrefix("Skills:") {
			return "sparkles"
		}
		if text.contains(" tools") || text.contains(" core tools") {
			return "wrench.and.screwdriver"
		}
		return "info.circle"
	}

	private var color: Color {
		switch tone {
		case "success":
			return .green
		case "error":
			return .red
		default:
			return AppTheme.secondaryText
		}
	}
}
