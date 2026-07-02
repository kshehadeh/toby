import SwiftUI

struct RecordingHeader: View {
	let detail: ListenRecordingDetail

	private var recordingStatusText: String {
		if detail.hasTranscript { return "Transcribed" }
		if detail.hasAudio { return "Recorded" }
		return "Saved"
	}

	private var statusColor: Color {
		if detail.hasTranscript { return .green }
		if detail.hasAudio { return .orange }
		return AppTheme.tertiaryText
	}

	var body: some View {
		HStack(alignment: .center, spacing: 14) {
			RoundedRectangle(cornerRadius: 13)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 56, height: 56)
				.overlay {
					Image(systemName: "waveform.circle")
						.font(.system(size: 28, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}

			VStack(alignment: .leading, spacing: 4) {
				Text(detail.metadata.name ?? "Recording")
					.font(.system(size: 20, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(friendlyRecordingDate(detail.metadata.startedAt, fallback: detail.metadata.createdAt))
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}

			Spacer(minLength: 12)

			HStack(spacing: 6) {
				Circle()
					.fill(statusColor)
					.frame(width: 6, height: 6)
				Text(recordingStatusText)
					.font(.system(size: 12, weight: .medium))
					.foregroundStyle(AppTheme.primaryText)
			}
			.padding(.horizontal, 10)
			.padding(.vertical, 5)
			.background(Color.white.opacity(0.05))
			.clipShape(Capsule())
			.overlay {
				Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1)
			}
		}
	}
}
