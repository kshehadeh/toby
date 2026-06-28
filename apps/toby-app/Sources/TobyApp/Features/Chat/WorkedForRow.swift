import AppKit
import SwiftUI

struct WorkedForRow: View {
	let group: TranscriptWorkGroup
	let duration: TimeInterval?
	let activeWorkStartDate: Date?
	let isExpanded: Bool
	let onToggle: () -> Void
	var streamingAssistant: StreamingAssistantState?
	var personaImage: URL?

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
									.font(AppTheme.transcriptCaptionFont.weight(.semibold))
									.foregroundStyle(AppTheme.secondaryText)
							}
							Text(summaryLabel(at: context.date))
								.font(AppTheme.transcriptCaptionFont.weight(.medium))
								.tracking(AppTheme.transcriptTracking)
								.foregroundStyle(AppTheme.secondaryText)
							if isExpanded, steps.count > 0 {
								Text("· \(steps.count) steps")
									.font(AppTheme.transcriptCaptionFont)
									.tracking(AppTheme.transcriptTracking)
									.foregroundStyle(AppTheme.tertiaryText)
							}
							Spacer(minLength: 0)
							if steps.count > 0 {
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

					if isExpanded {
						VStack(alignment: .leading, spacing: 0) {
							ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
								if index > 0 {
									Rectangle()
										.fill(AppTheme.separator)
										.frame(height: 1)
										.padding(.horizontal, 4)
								}
								WorkStepRow(step: step)
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
