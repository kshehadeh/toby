import SwiftUI

enum SettingsDesign {
	static let canvasBackground = Color(nsColor: .tobySettingsCanvas)
	static let cardBackground = Color(nsColor: .tobySettingsCard)
	static let cardBorder = Color(nsColor: .tobySettingsCardBorder)
	static let sectionHeader = Color(nsColor: .tobySettingsSectionHeader)
	static let rowTitle = Color(nsColor: .tobySettingsRowTitle)
	static let rowDescription = Color(nsColor: .tobySettingsRowDescription)
	static let controlBorder = Color(nsColor: .tobySettingsControlBorder)
	static let toggleTint = Color(red: 0.20, green: 0.78, blue: 0.35)
	static let sidebarSelection = Color(nsColor: .tobySettingsSidebarSelection)

	static let cardCornerRadius: CGFloat = 10
	static let controlCornerRadius: CGFloat = 6
	static let formRowHeight: CGFloat = 42
	static let formControlHeight: CGFloat = 24
	static let contentMaxWidth: CGFloat = 640
	static let rowVerticalPadding: CGFloat = 8
	static let rowHorizontalPadding: CGFloat = 10
}

extension View {
	/// Tahoe grouped-form chrome: inset sections, transparent canvas so window
	/// glass shows through, and a little space under the toolbar.
	func tobySettingsFormStyle() -> some View {
		formStyle(.grouped)
			.scrollContentBackground(.hidden)
			.contentMargins(.top, 8, for: .scrollContent)
	}

	@ViewBuilder
	func scrollEdgeEffectStyleSoftIfAvailable() -> some View {
		if #available(macOS 26.0, *) {
			scrollEdgeEffectStyle(.soft, for: .all)
		} else {
			self
		}
	}
}
