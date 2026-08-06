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

	// Inline status callouts (filled + outlined blocks for success / error)
	static let statusErrorBackground = Color(nsColor: .tobyStatusErrorBackground)
	static let statusErrorBorder = Color(nsColor: .tobyStatusErrorBorder)
	static let statusErrorForeground = Color(nsColor: .tobyStatusErrorForeground)
	static let statusSuccessBackground = Color(nsColor: .tobyStatusSuccessBackground)
	static let statusSuccessBorder = Color(nsColor: .tobyStatusSuccessBorder)
	static let statusSuccessForeground = Color(nsColor: .tobyStatusSuccessForeground)

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

	// Assistant answers are long-form prose: give them a paragraph-grade size and
	// generous leading so they read as the response, not a caption.
	static let transcriptAnswerFont: Font = .system(size: 15, weight: .regular, design: .serif)
	static let transcriptAnswerLineSpacing: CGFloat = 7

	// Step metadata (skills / tools / worked-for) is chrome around the answer:
	// small, tracked-out, uppercased so it recedes instead of competing.
	static let transcriptStepMetaFont: Font = .system(size: 10.5, weight: .medium, design: .rounded)
	/// +0.07em at 10.5pt.
	static let transcriptStepMetaTracking: CGFloat = 0.735

	// Table headers stay SF Pro, matching the body scale while remaining semibold.
	static let transcriptTableBodyFont: Font = .system(size: 14, weight: .regular, design: .rounded)
	static let transcriptTableHeaderFont: Font = .system(size: 14, weight: .semibold, design: .rounded)
}
