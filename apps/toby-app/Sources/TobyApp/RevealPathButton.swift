import SwiftUI

/// A path rendered as a clickable button that reveals the item in Finder.
/// Shows a button outline on hover and a "Reveal in Finder" tooltip.
struct RevealPathButton: View {
	let path: String
	var label: String? = nil
	@State private var isHovered = false

	var body: some View {
		Button {
			RevealInFinder.reveal(path: path)
		} label: {
			HStack(alignment: .top, spacing: 4) {
				Image(systemName: "folder")
					.font(.caption2)
					.foregroundStyle(isHovered ? AppTheme.accent : AppTheme.tertiaryText)
				VStack(alignment: .leading, spacing: 1) {
					if let label {
						Text(label)
							.font(.caption)
							.foregroundStyle(AppTheme.secondaryText)
					}
					Text(path)
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(2)
						.truncationMode(.middle)
				}
				Spacer(minLength: 0)
			}
			.padding(.horizontal, 6)
			.padding(.vertical, 4)
			.contentShape(RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius))
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(isHovered ? AppTheme.selection : Color.clear)
			)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.stroke(isHovered ? SettingsDesign.controlBorder : Color.clear, lineWidth: 1)
			)
			.animation(.easeInOut(duration: 0.15), value: isHovered)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.help("Reveal in Finder")
		.accessibilityLabel("Reveal in Finder")
		.accessibilityValue(path)
	}
}
