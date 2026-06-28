import AppKit
import SwiftUI

struct UserMessageRow: View {
	let text: String
	private static let collapsedLineLimit = 12
	private var isCopyable: Bool {
		!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	@State private var isExpanded = false

	private var isLargePrompt: Bool {
		text.components(separatedBy: "\n").count > Self.collapsedLineLimit
	}

	private var displayedText: String {
		guard isLargePrompt, !isExpanded else { return text }
		let lines = text.components(separatedBy: "\n")
		return lines.prefix(Self.collapsedLineLimit).joined(separator: "\n").trimmingCharacters(in: .newlines) + "…"
	}

	var body: some View {
		HStack(alignment: .top, spacing: 0) {
			Spacer(minLength: 0)
			VStack(alignment: .trailing, spacing: 6) {
				Text(displayedText)
					.font(AppTheme.transcriptBodyFont)
					.tracking(AppTheme.transcriptTracking)
					.lineSpacing(AppTheme.transcriptLineSpacing)
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
				if isLargePrompt {
					Button(action: {
						withAnimation(.easeOut(duration: 0.2)) {
							isExpanded.toggle()
						}
					}) {
						Text(isExpanded ? "Show less" : "Show more")
							.font(AppTheme.transcriptCaptionFont)
							.tracking(AppTheme.transcriptTracking)
							.foregroundStyle(AppTheme.accent)
					}
					.buttonStyle(.plain)
					.padding(.top, 2)
				}
				if isCopyable {
					CopyButton(text: text, label: "Copy prompt")
						.padding(.top, 2)
				}
			}
		}
	}
}
