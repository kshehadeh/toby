import SwiftUI

enum AppTheme {
	// Dynamic NSColors resolve at draw time against the view's effective
	// appearance (driven by preferredColorScheme). Prefer these over fixed RGB
	// so list/form rows update without a full view identity reset.
	static let sidebarBackground = Color(nsColor: .tobySidebarBackground)
	static let contentBackground = Color(nsColor: .tobyContentBackground)
	static let panelBackground = Color(nsColor: .tobyPanelBackground)
	static let elevatedBackground = Color(nsColor: .tobyElevatedBackground)
	static let separator = Color(nsColor: .tobySeparator)
	static let primaryText = Color(nsColor: .tobyPrimaryText)
	static let secondaryText = Color(nsColor: .tobySecondaryText)
	static let tertiaryText = Color(nsColor: .tobyTertiaryText)
	static let selection = Color(nsColor: .tobySelection)

	/// Brand accent from the user's Appearance preset (default orange).
	static var accent: Color {
		AccentPreset.current.color
	}

	static let sidebarWidth: CGFloat = 250
	static let minSidebarWidth: CGFloat = 250
	static let maxSidebarWidth: CGFloat = 320
	static let cornerRadius: CGFloat = 16
	static let smallCornerRadius: CGFloat = 9
	static let contentPadding: CGFloat = 24

	// Transcript typography: rounded SF Pro
	static let transcriptBodyFont: Font = .system(.body, design: .rounded, weight: .regular)
	static let transcriptCalloutFont: Font = .system(.callout, design: .rounded, weight: .regular)
	static let transcriptCaptionFont: Font = .system(.caption, design: .rounded, weight: .medium)
}
