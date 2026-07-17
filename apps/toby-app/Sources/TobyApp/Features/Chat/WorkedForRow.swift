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

	private var steps: [WorkStep] {
		guard showsWorkDetails else { return [] }
		return workSteps(from: group)
	}

	private var toolStepCount: Int {
		steps.filter { $0.type != .assistantInterim }.count
	}

	private var hasExpandableContent: Bool {
		showsWorkDetails && (!steps.isEmpty || streamingAssistant != nil)
	}

	var body: some View {
		TimelineView(.periodic(from: .now, by: 1.0)) { context in
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
							Text(summaryLabel(at: context.date))
								.font(AppTheme.transcriptCaptionFont.weight(.medium))
								.foregroundStyle(AppTheme.secondaryText)
							if isExpanded, toolStepCount > 0 {
								Text("· \(toolStepCount) step\(toolStepCount == 1 ? "" : "s")")
									.font(AppTheme.transcriptCaptionFont)
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
						VStack(alignment: .leading, spacing: 0) {
							ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
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
		WorkDurationFormatter.format(interval)
	}
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
					font: AppTheme.transcriptBodyFont,
					foregroundStyle: AppTheme.primaryText,
				)
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
