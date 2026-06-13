import SwiftUI

enum AppTheme {
	static let sidebarBackground = Color(red: 0.12, green: 0.14, blue: 0.15)
	static let contentBackground = Color(red: 0.08, green: 0.08, blue: 0.08)
	static let panelBackground = Color(red: 0.15, green: 0.15, blue: 0.15)
	static let elevatedBackground = Color(red: 0.18, green: 0.18, blue: 0.18)
	static let separator = Color.white.opacity(0.08)
	static let primaryText = Color.white.opacity(0.88)
	static let secondaryText = Color.white.opacity(0.58)
	static let tertiaryText = Color.white.opacity(0.38)
	static let accent = Color(red: 0.96, green: 0.62, blue: 0.12)
	static let selection = Color.white.opacity(0.08)

	static let sidebarWidth: CGFloat = 244
	static let cornerRadius: CGFloat = 16
	static let smallCornerRadius: CGFloat = 9
	static let contentPadding: CGFloat = 24
}
