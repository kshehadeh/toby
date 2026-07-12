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
