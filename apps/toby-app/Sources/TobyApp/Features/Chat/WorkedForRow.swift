import AppKit
import SwiftUI

struct WorkedForRow: View {
	let group: TranscriptWorkGroup
	let duration: TimeInterval?
	let activeWorkStartDate: Date?
	let isExpanded: Bool
	let onToggle: () -> Void
	/// When false (normal chat mode), only the summary chip is shown — no tool/prep steps.
	var showsWorkDetails = true
	var streamingAssistant: StreamingAssistantState?
	var personaImage: URL?

	/// Parsed only while expanded (or when needed for an active live label).
	@State private var cachedSteps: [WorkStep] = []
	@State private var cachedStepsGroupId: String?
	@State private var cachedStepsEntryCount: Int?

	/// Expandability must not parse tool bodies — empty groups never expand.
	private var hasExpandableContent: Bool {
		showsWorkDetails && (!group.entries.isEmpty || streamingAssistant != nil)
	}

	private var steps: [WorkStep] {
		guard showsWorkDetails, isExpanded || group.isActive else { return [] }
		if cachedStepsGroupId == group.id, cachedStepsEntryCount == group.entries.count {
			return cachedSteps
		}
		return workSteps(from: group)
	}

	private var toolStepCount: Int {
		guard isExpanded else { return 0 }
		return steps.filter { $0.type != .assistantInterim }.count
	}

	var body: some View {
		// Only tick the live "Working for…" label while a turn is active.
		Group {
			if group.isActive {
				TimelineView(.periodic(from: .now, by: 1.0)) { context in
					chipContent(at: context.date)
				}
			} else {
				chipContent(at: .now)
			}
		}
		.onChange(of: isExpanded) { _, expanded in
			if expanded { refreshStepsCacheIfNeeded() }
		}
		.onChange(of: group.id) { _, _ in
			cachedSteps = []
			cachedStepsGroupId = nil
			cachedStepsEntryCount = nil
			if isExpanded || group.isActive { refreshStepsCacheIfNeeded() }
		}
		.onChange(of: group.entries.count) { _, _ in
			if isExpanded || group.isActive { refreshStepsCacheIfNeeded(force: true) }
		}
	}

	private func refreshStepsCacheIfNeeded(force: Bool = false) {
		guard showsWorkDetails else {
			cachedSteps = []
			cachedStepsGroupId = group.id
			cachedStepsEntryCount = group.entries.count
			return
		}
		if !force,
			cachedStepsGroupId == group.id,
			cachedStepsEntryCount == group.entries.count
		{
			return
		}
		cachedSteps = workSteps(from: group)
		cachedStepsGroupId = group.id
		cachedStepsEntryCount = group.entries.count
	}

	private func chipContent(at date: Date) -> some View {
		HStack(alignment: .top, spacing: 0) {
			VStack(alignment: .leading, spacing: 0) {
				Button(action: {
					guard hasExpandableContent else { return }
					onToggle()
				}) {
					HStack(spacing: 8) {
						if group.isActive {
							ProgressView()
								.controlSize(.small)
								.frame(width: 14, height: 14)
						} else {
							Image(systemName: "clock")
								.font(AppTheme.transcriptCaptionFont.weight(.semibold))
								.foregroundStyle(AppTheme.secondaryText)
						}
						Text(summaryLabel(at: date))
							.font(AppTheme.transcriptStepMetaFont)
							.tracking(AppTheme.transcriptStepMetaTracking)
							.textCase(.uppercase)
							.foregroundStyle(AppTheme.secondaryText)
						if isExpanded, toolStepCount > 0 {
							Text("· \(toolStepCount) step\(toolStepCount == 1 ? "" : "s")")
								.font(AppTheme.transcriptStepMetaFont)
								.tracking(AppTheme.transcriptStepMetaTracking)
								.textCase(.uppercase)
								.foregroundStyle(AppTheme.tertiaryText)
						}
						Spacer(minLength: 0)
						if hasExpandableContent {
							Image(systemName: "chevron.right")
								.font(AppTheme.transcriptCaptionFont.weight(.semibold))
								.foregroundStyle(AppTheme.tertiaryText)
								.rotationEffect(.degrees(isExpanded ? 90 : 0))
						}
					}
					.padding(.vertical, 10)
					.padding(.horizontal, 12)
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.background(
					RoundedRectangle(cornerRadius: 12, style: .continuous)
						.fill(Color.white.opacity(0.03))
				)

				if isExpanded, showsWorkDetails {
					let resolvedSteps = steps
					VStack(alignment: .leading, spacing: 0) {
						ForEach(Array(resolvedSteps.enumerated()), id: \.element.id) { index, step in
							if index > 0 {
								Rectangle()
									.fill(AppTheme.separator)
									.frame(height: 1)
									.padding(.horizontal, 4)
							}
							if step.type == .assistantInterim {
								AssistantWorkMessageRow(step: step, personaImage: personaImage)
							} else {
								WorkStepRow(step: step)
							}
						}
						if let streamingAssistant {
							Rectangle()
								.fill(AppTheme.separator)
								.frame(height: 1)
								.padding(.horizontal, 4)
							AssistantMessageRow(
								iconName: "sparkle",
								header: streamingAssistant.header,
								messageBody: streamingAssistant.text,
								isStreaming: true,
								personaImage: personaImage,
							)
						}
					}
					.padding(.horizontal, 12)
					.padding(.bottom, 12)
					.transition(.opacity.combined(with: .move(edge: .top)))
				}
			}
			.frame(maxWidth: 640, alignment: .leading)
			.overlay(
				RoundedRectangle(cornerRadius: 12, style: .continuous)
					.stroke(AppTheme.separator)
			)
			.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
			Spacer(minLength: 0)
		}
		.animation(.easeOut(duration: 0.2), value: isExpanded)
	}

	private func summaryLabel(at date: Date) -> String {
		let elapsed = liveDuration(at: date)
		if group.isActive {
			if let elapsed {
				return "Working for \(formatSeconds(elapsed))…"
			}
			return "Working…"
		}
		// Collapsed chips use the stored group duration only — never re-parse
		// tool steps (that was a major freeze source on long project chats).
		if isExpanded {
			let stepDuration = workStepDuration(from: steps)
			let completedDuration = [elapsed, stepDuration].compactMap { $0 }.max()
			return workedSummaryLabel(duration: completedDuration)
		}
		return workedSummaryLabel(duration: elapsed)
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
		WorkDurationFormatter.format(interval)
	}
}

func workedSummaryLabel(duration: TimeInterval?) -> String {
	guard let duration, duration >= 1 else {
		return "Worked for a short time"
	}
	return "Worked for \(WorkDurationFormatter.format(duration))"
}

func workStepDuration(from steps: [WorkStep]) -> TimeInterval? {
	let durationMs = steps.reduce(0) { total, step in
		if let durationMs = step.durationMs {
			return total + durationMs
		}
		let childDurationMs = step.children.compactMap(\.durationMs).reduce(0, +)
		return total + childDurationMs
	}
	return durationMs > 0 ? TimeInterval(durationMs) / 1000.0 : nil
}

private struct AssistantWorkMessageRow: View {
	let step: WorkStep
	var personaImage: URL?
	@State private var isExpanded = false

	private var messageBody: String {
		step.fullBody ?? step.body
	}

	private var isExpandable: Bool {
		hasMoreBodyToShow(step)
	}

	var body: some View {
		Group {
			if isExpandable {
				Button {
					withAnimation(.easeOut(duration: 0.2)) {
						isExpanded.toggle()
					}
				} label: {
					content
				}
				.buttonStyle(.plain)
				.modifier(PointingHandOnHover())
				.accessibilityLabel(isExpanded ? "Collapse assistant message" : "Expand assistant message")
			} else {
				content
			}
		}
		.padding(.vertical, 8)
	}

	private var content: some View {
		HStack(alignment: .top, spacing: 10) {
			AssistantRailColumn(iconName: "sparkle", personaImage: personaImage)
			VStack(alignment: .leading, spacing: 6) {
				Text(step.title)
					.font(AppTheme.transcriptCaptionFont.weight(.semibold))
					.foregroundStyle(AppTheme.secondaryText)
				MarkdownText(
					text: messageBody,
					font: AppTheme.transcriptAnswerFont,
					foregroundStyle: AppTheme.primaryText,
					usesProseTypography: true,
				)
				.lineSpacing(AppTheme.transcriptAnswerLineSpacing)
				.lineLimit(isExpanded || !isExpandable ? nil : 4)
				.fixedSize(horizontal: false, vertical: true)
				.frame(maxWidth: .infinity, alignment: .leading)
				if isExpandable {
					HStack(spacing: 4) {
						Text(isExpanded ? "Show less" : "Show more")
						Image(systemName: "chevron.right")
							.rotationEffect(.degrees(isExpanded ? -90 : 90))
					}
					.font(AppTheme.transcriptCaptionFont.weight(.medium))
					.foregroundStyle(AppTheme.accent)
					.padding(.top, 2)
				}
				if isExpanded || !isExpandable {
					HStack {
						CopyButton(text: messageBody, label: "Copy response")
						Spacer(minLength: 0)
					}
					.padding(.top, 2)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.contentShape(Rectangle())
	}
}

private struct PointingHandOnHover: ViewModifier {
	@State private var isHovering = false

	func body(content: Content) -> some View {
		content
			.onHover { hovering in
				if hovering, !isHovering {
					NSCursor.pointingHand.push()
				} else if !hovering, isHovering {
					NSCursor.pop()
				}
				isHovering = hovering
			}
			.onDisappear {
				if isHovering {
					NSCursor.pop()
					isHovering = false
				}
			}
	}
}
