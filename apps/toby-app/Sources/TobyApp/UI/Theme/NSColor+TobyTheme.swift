import AppKit

/// Dynamic AppKit colors that flip with light / dark appearance.
/// Used by `AppTheme` / `SettingsDesign` and by AppKit islands (logs, markdown).
extension NSColor {
	private static func tobyDynamic(
		name: String,
		light: (CGFloat, CGFloat, CGFloat, CGFloat),
		dark: (CGFloat, CGFloat, CGFloat, CGFloat)
	) -> NSColor {
		NSColor(name: name) { appearance in
			let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
			let c = isDark ? dark : light
			return NSColor(calibratedRed: c.0, green: c.1, blue: c.2, alpha: c.3)
		}
	}

	// MARK: App chrome

	static let tobySidebarBackground = tobyDynamic(
		name: "tobySidebarBackground",
		light: (0.95, 0.95, 0.96, 1),
		dark: (0.12, 0.14, 0.15, 1)
	)

	static let tobyContentBackground = tobyDynamic(
		name: "tobyContentBackground",
		light: (0.99, 0.99, 0.99, 1),
		dark: (0.08, 0.08, 0.08, 1)
	)

	static let tobyPanelBackground = tobyDynamic(
		name: "tobyPanelBackground",
		light: (0.94, 0.94, 0.95, 1),
		dark: (0.15, 0.15, 0.15, 1)
	)

	static let tobyElevatedBackground = tobyDynamic(
		name: "tobyElevatedBackground",
		light: (0.97, 0.97, 0.98, 1),
		dark: (0.18, 0.18, 0.18, 1)
	)

	static let tobySeparator = tobyDynamic(
		name: "tobySeparator",
		light: (0, 0, 0, 0.10),
		dark: (1, 1, 1, 0.08)
	)

	static let tobyPrimaryText = tobyDynamic(
		name: "tobyPrimaryText",
		light: (0, 0, 0, 0.88),
		dark: (1, 1, 1, 0.88)
	)

	static let tobySecondaryText = tobyDynamic(
		name: "tobySecondaryText",
		light: (0, 0, 0, 0.55),
		dark: (1, 1, 1, 0.58)
	)

	static let tobyTertiaryText = tobyDynamic(
		name: "tobyTertiaryText",
		light: (0, 0, 0, 0.38),
		dark: (1, 1, 1, 0.38)
	)

	static let tobySelection = tobyDynamic(
		name: "tobySelection",
		light: (0, 0, 0, 0.06),
		dark: (1, 1, 1, 0.08)
	)

	// MARK: Settings surfaces

	static let tobySettingsCanvas = tobyDynamic(
		name: "tobySettingsCanvas",
		light: (0.96, 0.96, 0.97, 1),
		dark: (0.10, 0.10, 0.11, 1)
	)

	static let tobySettingsCard = tobyDynamic(
		name: "tobySettingsCard",
		light: (1, 1, 1, 1),
		dark: (0.16, 0.16, 0.17, 1)
	)

	static let tobySettingsCardBorder = tobyDynamic(
		name: "tobySettingsCardBorder",
		light: (0, 0, 0, 0.08),
		dark: (1, 1, 1, 0.07)
	)

	static let tobySettingsSectionHeader = tobyDynamic(
		name: "tobySettingsSectionHeader",
		light: (0, 0, 0, 0.45),
		dark: (1, 1, 1, 0.45)
	)

	static let tobySettingsRowTitle = tobyDynamic(
		name: "tobySettingsRowTitle",
		light: (0, 0, 0, 0.92),
		dark: (1, 1, 1, 0.92)
	)

	static let tobySettingsRowDescription = tobyDynamic(
		name: "tobySettingsRowDescription",
		light: (0, 0, 0, 0.42),
		dark: (1, 1, 1, 0.42)
	)

	static let tobySettingsControlBorder = tobyDynamic(
		name: "tobySettingsControlBorder",
		light: (0, 0, 0, 0.14),
		dark: (1, 1, 1, 0.14)
	)

	static let tobySettingsSidebarSelection = tobyDynamic(
		name: "tobySettingsSidebarSelection",
		light: (0, 0, 0, 0.08),
		dark: (1, 1, 1, 0.10)
	)

	// MARK: Logs / markdown (AppKit)

	static let tobyLogBackground = tobyDynamic(
		name: "tobyLogBackground",
		light: (0.97, 0.97, 0.98, 1),
		dark: (0.08, 0.08, 0.09, 1)
	)

	static let tobyMarkdownPrimary = tobyDynamic(
		name: "tobyMarkdownPrimary",
		light: (0.12, 0.12, 0.14, 1),
		dark: (0.949, 0.949, 0.957, 1)
	)

	static let tobyMarkdownMarker = tobyDynamic(
		name: "tobyMarkdownMarker",
		light: (0, 0, 0, 0.35),
		dark: (1, 1, 1, 0.35)
	)

	static let tobyMarkdownHeading = tobyDynamic(
		name: "tobyMarkdownHeading",
		light: (0.15, 0.40, 0.75, 1),
		dark: (0.427, 0.702, 0.973, 1)
	)

	static let tobyMarkdownCode = tobyDynamic(
		name: "tobyMarkdownCode",
		light: (0.70, 0.40, 0.10, 1),
		dark: (0.902, 0.647, 0.416, 1)
	)

	static let tobyMarkdownCodeBackground = tobyDynamic(
		name: "tobyMarkdownCodeBackground",
		light: (0, 0, 0, 0.05),
		dark: (1, 1, 1, 0.05)
	)

	static let tobyMarkdownBold = tobyDynamic(
		name: "tobyMarkdownBold",
		light: (0, 0, 0, 0.92),
		dark: (1, 1, 1, 0.95)
	)
}
