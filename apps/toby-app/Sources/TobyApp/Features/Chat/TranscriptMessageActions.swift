import SwiftUI

/// Copy + relative time footer under a transcript message.
struct TranscriptMessageActions: View {
	let copyText: String
	let copyLabel: String
	var createdAt: String? = nil

	private var isCopyable: Bool {
		!copyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	var body: some View {
		if isCopyable || createdAt != nil {
			TimelineView(.periodic(from: .now, by: 15)) { context in
				HStack(spacing: 10) {
					if isCopyable {
						CopyButton(text: copyText, label: copyLabel)
					}
					Spacer(minLength: 0)
					if let createdAt,
						let label = TranscriptTimestamp.compactRelative(
							fromISO: createdAt,
							now: context.date
						)
					{
						Text(label)
							.font(AppTheme.transcriptCaptionFont)
							.foregroundStyle(AppTheme.tertiaryText)
							.monospacedDigit()
							.accessibilityLabel(label)
					}
				}
				.padding(.top, 2)
			}
			.accessibilityIdentifier("transcript-message-actions")
		}
	}
}
