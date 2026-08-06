import SwiftUI

struct ScheduleRunDetailView: View {
	@Environment(\.dismiss) private var dismiss
	let run: ScheduleRunDetail?
	let isLoading: Bool
	let error: String?
	@State private var currentTime = Date()
	private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

	var body: some View {
		NavigationStack {
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					if isLoading && run == nil {
						ProgressView("Loading run…")
							.frame(maxWidth: .infinity, minHeight: 200)
					} else if let error, run == nil {
						ContentUnavailableView {
							Label("Run unavailable", systemImage: "exclamationmark.triangle")
						} description: {
							Text(error)
						}
					} else if let run {
						runContent(run)
					}
				}
				.frame(maxWidth: SettingsDesign.contentMaxWidth)
				.frame(maxWidth: .infinity)
				.padding(.horizontal, 24)
				.padding(.vertical, 20)
			}
			.background(SettingsDesign.canvasBackground)
			.navigationTitle(titleText)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Close") {
						dismiss()
					}
				}
			}
		}
		.frame(minWidth: 560, minHeight: 400)
		.onReceive(timer) { _ in
			currentTime = Date()
		}
	}

	private var titleText: String {
		guard let run else { return "Run" }
		let elapsed = runElapsedSeconds(run, now: currentTime)
		return "\(run.titleScheduleName) - \(formatDuration(elapsed))"
	}

	private func runElapsedSeconds(_ run: ScheduleRunDetail, now: Date) -> TimeInterval {
		let start = ISO8601DateParser.date(from: run.startedAt) ?? now
		let end = run.completedAt.flatMap(ISO8601DateParser.date) ?? now
		return max(0, end.timeIntervalSince(start))
	}

	private func runContent(_ run: ScheduleRunDetail) -> some View {
		VStack(alignment: .leading, spacing: 20) {
			HStack(spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(runStatusColor(run.status).opacity(0.18))
					.frame(width: 40, height: 40)
					.overlay {
						Image(systemName: statusIcon(for: run.status))
							.font(.system(size: 18))
							.foregroundStyle(runStatusColor(run.status))
					}
				VStack(alignment: .leading, spacing: 2) {
					Text(run.displayStatus)
						.font(.headline)
						.foregroundStyle(AppTheme.primaryText)
					Text(timeText(for: run))
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}

			if let error = run.error, !error.isEmpty {
				ScheduleSection(title: "Error") {
					InlineStatusMessage(
						message: error,
						tone: .error,
						font: .body,
						allowsTextSelection: true
					)
					.padding(SettingsDesign.rowHorizontalPadding)
					.padding(.vertical, SettingsDesign.rowVerticalPadding)
				}
			}

			if let output = run.output, !output.isEmpty {
				ScheduleSection(title: "Output") {
					Text(output)
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
				}
			}

			if !run.transcript.isEmpty {
				ScheduleSection(title: "Transcript") {
					VStack(alignment: .leading, spacing: 0) {
						ForEach(renderedTranscript(from: run.transcript)) { item in
							transcriptRow(item)
							if item.id != renderedTranscript(from: run.transcript).last?.id {
								Rectangle()
									.fill(SettingsDesign.cardBorder)
									.frame(height: 1)
									.padding(.leading, SettingsDesign.rowHorizontalPadding)
							}
						}
					}
				}
			}
		}
	}

	private func renderedTranscript(from events: [ScheduleRunTranscriptEvent]) -> [TranscriptRenderItem] {
		var items: [TranscriptRenderItem] = []
		var assistantBuffer: String = ""
		var assistantHeader: String? = nil
		var reasoningBuffer: String = ""

		func flushAssistant() {
			if !assistantBuffer.isEmpty || assistantHeader != nil {
				items.append(TranscriptRenderItem(
					id: "assistant-\(items.count)",
					text: assistantBuffer,
					icon: "text.bubble",
					color: AppTheme.primaryText,
					header: assistantHeader
				))
				assistantBuffer = ""
				assistantHeader = nil
			}
		}

		func flushReasoning() {
			if !reasoningBuffer.isEmpty {
				items.append(TranscriptRenderItem(
					id: "reasoning-\(items.count)",
					text: reasoningBuffer,
					icon: "brain",
					color: AppTheme.tertiaryText,
					header: "Thinking"
				))
				reasoningBuffer = ""
			}
		}

		for event in events {
			switch event.type {
			case "lifecycle_start":
				flushAssistant(); flushReasoning()
				items.append(TranscriptRenderItem(
					id: "lifecycle-\(items.count)",
					text: event.header ?? "",
					icon: "gear",
					color: AppTheme.tertiaryText,
					header: event.header
				))
			case "lifecycle_end":
				items.append(TranscriptRenderItem(
					id: "lifecycle-\(items.count)",
					text: event.detail ?? "",
					icon: "checkmark",
					color: AppTheme.tertiaryText,
					header: nil
				))
			case "assistant_segment_start":
				flushAssistant(); flushReasoning()
				assistantHeader = event.header
			case "assistant_text_delta":
				assistantBuffer.append(event.delta ?? "")
			case "assistant_segment_end":
				flushAssistant()
			case "reasoning_start":
				flushAssistant()
			case "reasoning_delta":
				reasoningBuffer.append(event.text ?? "")
			case "reasoning_end":
				flushReasoning()
			case "tool_call_start":
				flushAssistant(); flushReasoning()
				items.append(TranscriptRenderItem(
					id: "tool-start-\(items.count)",
					text: event.toolName ?? "Tool",
					icon: "wrench",
					color: AppTheme.accent,
					header: "Using \(event.toolName ?? "tool")"
				))
			case "tool_call_complete":
				let duration = event.durationMs.map { " \($0)ms" } ?? ""
				items.append(TranscriptRenderItem(
					id: "tool-done-\(items.count)",
					text: (event.toolName ?? "Tool") + duration,
					icon: event.error == nil ? "checkmark.circle" : "xmark.circle",
					color: event.error == nil ? Color.green : Color.red,
					header: nil
				))
			case "transcript_notice":
				flushAssistant(); flushReasoning()
				items.append(TranscriptRenderItem(
					id: "notice-\(items.count)",
					text: event.text ?? "",
					icon: "info.circle",
					color: AppTheme.secondaryText,
					header: nil
				))
			default:
				break
			}
		}
		flushAssistant()
		flushReasoning()
		return items
	}

	private func transcriptRow(_ item: TranscriptRenderItem) -> some View {
		HStack(alignment: .top, spacing: 10) {
			Image(systemName: item.icon)
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(item.color)
				.frame(width: 18, height: 18)
			VStack(alignment: .leading, spacing: 4) {
				if let header = item.header {
					Text(header)
						.font(.caption.weight(.medium))
						.foregroundStyle(AppTheme.tertiaryText)
				}
				Text(item.text)
					.font(.body)
					.foregroundStyle(item.color)
					.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
		.padding(.vertical, SettingsDesign.rowVerticalPadding)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private func timeText(for run: ScheduleRunDetail) -> String {
		let started = DateFormatter.localizedString(from: ISO8601DateParser.date(from: run.startedAt) ?? Date(), dateStyle: .medium, timeStyle: .short)
		if let completedAt = run.completedAt, let completed = ISO8601DateParser.date(from: completedAt) {
			let duration = completed.timeIntervalSince(ISO8601DateParser.date(from: run.startedAt) ?? Date())
			return "Started \(started) · \(formatDuration(duration))"
		}
		return "Started \(started)"
	}

	private func formatDuration(_ seconds: TimeInterval) -> String {
		let minutes = Int(seconds / 60)
		let remainingSeconds = Int(seconds) % 60
		if minutes > 0 {
			return "\(minutes)m \(remainingSeconds)s"
		}
		return "\(remainingSeconds)s"
	}

	private func statusIcon(for status: String) -> String {
		switch status.lowercased() {
		case "success": return "checkmark.circle"
		case "error": return "xmark.circle"
		case "running": return "clock"
		default: return "clock"
		}
	}

	private func runStatusColor(_ status: String) -> Color {
		switch status.lowercased() {
		case "success": return Color.green
		case "error": return Color.red
		case "running": return Color.orange
		default: return AppTheme.tertiaryText
		}
	}
}

private struct TranscriptRenderItem: Identifiable {
	let id: String
	let text: String
	let icon: String
	let color: Color
	let header: String?
}

private enum ISO8601DateParser {
	static func date(from string: String) -> Date? {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.date(from: string)
	}
}
