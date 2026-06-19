import AppKit
import SwiftUI

struct TranscriptView: View {
	let entries: [TranscriptEntry]
	let streamingAssistant: StreamingAssistantState?
	var isLoading = false
	var turnWorkDurations: [Int: TimeInterval] = [:]
	var activeWorkStartDate: Date?
	var bottomContentPadding: CGFloat = 18
	private let bottomAnchorID = "transcript-bottom-anchor"

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
				VStack(alignment: .leading, spacing: 22) {
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
						AssistantMessageRow(
							iconName: "sparkle",
							header: streamingAssistant.header,
							messageBody: streamingAssistant.text,
							isStreaming: true,
						)
						.id("streaming")
					}
					Color.clear
						.frame(height: bottomContentPadding)
						.id(bottomAnchorID)
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, AppTheme.contentPadding)
				.padding(.top, 10)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
			proxy.scrollTo(bottomAnchorID, anchor: .bottom)
		}
	}
}

private struct AssistantRailColumn: View {
	let iconName: String
	var iconColor: Color? = nil

	var body: some View {
		VStack(spacing: 0) {
			Image(systemName: iconName)
				.font(.system(size: 10, weight: .semibold))
				.foregroundStyle(iconColor ?? AppTheme.accent)
				.frame(width: 26, height: 26)
				.background(Circle().fill(AppTheme.panelBackground))
				.overlay(Circle().stroke(AppTheme.accent.opacity(0.4), lineWidth: 1))
			Rectangle()
				.fill(AppTheme.accent.opacity(0.35))
				.frame(width: 1.5)
				.frame(maxHeight: .infinity)
				.padding(.top, 6)
		}
		.frame(width: 34)
	}
}

private struct WorkedForRow: View {
	let group: TranscriptWorkGroup
	let duration: TimeInterval?
	let activeWorkStartDate: Date?
	let isExpanded: Bool
	let onToggle: () -> Void
	var streamingAssistant: StreamingAssistantState?

	private var steps: [WorkStep] {
		workSteps(from: group)
	}

	var body: some View {
		TimelineView(.periodic(from: .now, by: 1.0)) { context in
			HStack(alignment: .top, spacing: 0) {
				VStack(alignment: .leading, spacing: 0) {
					Button(action: onToggle) {
						HStack(spacing: 8) {
							if group.isActive {
								ProgressView()
									.controlSize(.small)
									.frame(width: 14, height: 14)
							} else {
								Image(systemName: "clock")
									.font(.caption.weight(.semibold))
									.foregroundStyle(AppTheme.secondaryText)
							}
							Text(summaryLabel(at: context.date))
								.font(.caption.weight(.medium))
								.foregroundStyle(AppTheme.secondaryText)
							if isExpanded, steps.count > 0 {
								Text("· \(steps.count) steps")
									.font(.caption)
									.foregroundStyle(AppTheme.tertiaryText)
							}
							Spacer(minLength: 0)
							Image(systemName: "chevron.right")
								.font(.caption.weight(.semibold))
								.foregroundStyle(AppTheme.tertiaryText)
								.rotationEffect(.degrees(isExpanded ? 90 : 0))
						}
						.padding(.vertical, 10)
						.padding(.horizontal, 12)
						.contentShape(Rectangle())
					}
					.buttonStyle(.plain)

					if isExpanded {
						VStack(alignment: .leading, spacing: 0) {
							ForEach(steps) { step in
								WorkStepRow(step: step)
							}
							if let streamingAssistant {
								AssistantMessageRow(
									iconName: "sparkle",
									header: streamingAssistant.header,
									messageBody: streamingAssistant.text,
									isStreaming: true,
								)
							}
						}
						.padding(.horizontal, 12)
						.padding(.bottom, 12)
						.transition(.opacity.combined(with: .move(edge: .top)))
					}
				}
				.frame(maxWidth: 640, alignment: .leading)
				.background(
					RoundedRectangle(cornerRadius: 12, style: .continuous)
						.fill(AppTheme.panelBackground)
				)
				.overlay(
					RoundedRectangle(cornerRadius: 12, style: .continuous)
						.stroke(AppTheme.separator)
				)
				.clipped()
				Spacer(minLength: 0)
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

private struct WorkStep: Identifiable {
	let id: String
	let title: String
	let body: String
	let durationMs: Int?
	let isActive: Bool
	let cacheHit: Bool?
	let isAssistantInterim: Bool
}

private func workSteps(from group: TranscriptWorkGroup) -> [WorkStep] {
	let entries = group.entries
	return entries.enumerated().compactMap { index, entry in
		switch entry {
		case .boxedStep(let payload):
			if payload.variant == "lifecycle", TranscriptGrouping.isHiddenLifecycleHeader(payload.header) {
				return nil
			}
			let isActive = group.isActive && index == entries.count - 1 && payload.durationMs == nil
			let title = payload.toolName ?? payload.header
			return WorkStep(
				id: "\(payload.id)-\(payload.seq)",
				title: title,
				body: payload.body,
				durationMs: payload.durationMs,
				isActive: isActive,
				cacheHit: payload.cacheHit,
				isAssistantInterim: payload.variant == "assistant_interim"
			)
		case .toolCall(let blockKey, let title):
			let isActive = group.isActive && index == entries.count - 1
			return WorkStep(
				id: "tool-call-\(blockKey)",
				title: title,
				body: "",
				durationMs: nil,
				isActive: isActive,
				cacheHit: nil,
				isAssistantInterim: false
			)
		case .toolOutput(let blockKey, let detail):
			return WorkStep(
				id: "tool-output-\(blockKey)",
				title: "Result",
				body: detail,
				durationMs: nil,
				isActive: false,
				cacheHit: nil,
				isAssistantInterim: false
			)
		case .meta(let text):
			return WorkStep(
				id: "meta-\(text.hashValue)",
				title: "Info",
				body: text,
				durationMs: nil,
				isActive: false,
				cacheHit: nil,
				isAssistantInterim: false
			)
		default:
			return nil
		}
	}
}

private struct WorkStepRow: View {
	let step: WorkStep

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			statusIndicator
			VStack(alignment: .leading, spacing: 2) {
				HStack(alignment: .top, spacing: 8) {
					Text(step.title)
						.font(.caption.weight(.semibold))
						.foregroundStyle(AppTheme.secondaryText)
					Spacer(minLength: 0)
					if let durationMs = step.durationMs, durationMs > 0 {
						Text(formatDurationMs(durationMs))
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.monospacedDigit()
					}
				}
				if !step.body.isEmpty {
					if step.isAssistantInterim {
						MarkdownText(
							text: step.body,
							font: .caption,
							foregroundStyle: AppTheme.tertiaryText,
						)
						.frame(maxWidth: .infinity, alignment: .leading)
					} else {
						Text(step.body)
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.lineLimit(4)
							.frame(maxWidth: .infinity, alignment: .leading)
					}
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}

	@ViewBuilder
	private var statusIndicator: some View {
		if step.isActive {
			ProgressView()
				.controlSize(.small)
				.frame(width: 8, height: 8)
		} else if step.cacheHit == true {
			Image(systemName: "checkmark.circle.fill")
				.font(.system(size: 8))
				.foregroundStyle(AppTheme.accent)
		} else {
			Circle()
				.fill(AppTheme.accent)
				.frame(width: 8, height: 8)
		}
	}

	private func formatDurationMs(_ ms: Int) -> String {
		let seconds = Double(ms) / 1000.0
		if seconds < 0.1 {
			return "0.1s"
		}
		if seconds < 100 {
			return String(format: "%.1fs", seconds)
		}
		return String(format: "%.0fs", seconds)
	}
}

private struct TranscriptRow: View {
	let entry: TranscriptEntry

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

private struct UserMessageRow: View {
	let text: String

	var body: some View {
		HStack(alignment: .top, spacing: 0) {
			Spacer(minLength: 0)
			Text(text)
				.font(.body)
				.foregroundStyle(AppTheme.primaryText)
				.textSelection(.enabled)
				.fixedSize(horizontal: false, vertical: true)
				.padding(.horizontal, 16)
				.padding(.vertical, 12)
				.background(
					RoundedRectangle(cornerRadius: 14, style: .continuous)
						.fill(AppTheme.elevatedBackground.opacity(0.92))
				)
				.overlay(
					RoundedRectangle(cornerRadius: 14, style: .continuous)
						.stroke(AppTheme.separator)
				)
				.overlay(alignment: .leading) {
					RoundedRectangle(cornerRadius: 14, style: .continuous)
						.fill(AppTheme.accent)
						.mask(alignment: .leading) {
							Rectangle()
								.frame(width: 4)
						}
				}
				.frame(maxWidth: 520, alignment: .trailing)
		}
	}
}

private struct AssistantMessageRow: View {
	let iconName: String
	let header: String
	let messageBody: String
	let isStreaming: Bool

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			AssistantRailColumn(iconName: iconName)
			VStack(alignment: .leading, spacing: 6) {
				Text(header)
					.font(.caption.weight(.semibold))
					.foregroundStyle(AppTheme.secondaryText)
				MarkdownText(
					text: messageBody,
					font: .body,
					foregroundStyle: AppTheme.primaryText,
				)
				.frame(maxWidth: .infinity, alignment: .leading)
				if isStreaming {
					ProgressView()
						.controlSize(.small)
				} else if !messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					HStack {
						CopyResponseButton(text: messageBody)
						Spacer(minLength: 0)
					}
					.padding(.top, 2)
				}
			}
			.frame(maxWidth: 640, alignment: .leading)
			Spacer(minLength: 0)
		}
	}
}

private struct AskUserQARow: View {
	let query: String
	let answer: String
	let error: String?

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			AssistantRailColumn(iconName: "questionmark.bubble")
			VStack(alignment: .leading, spacing: 6) {
				Text(query)
					.font(.callout.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				if let error {
					Text(error)
						.font(.callout)
						.foregroundStyle(.red)
						.textSelection(.enabled)
				} else {
					Text(answer)
						.font(.callout)
						.foregroundStyle(AppTheme.secondaryText)
						.textSelection(.enabled)
				}
			}
			.frame(maxWidth: 520, alignment: .leading)
			Spacer(minLength: 0)
		}
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
