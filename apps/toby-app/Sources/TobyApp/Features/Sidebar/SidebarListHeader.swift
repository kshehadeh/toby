import SwiftUI

struct SidebarListHeader: View {
	let title: String
	let systemImage: String
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: systemImage)
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.accent : AppTheme.tertiaryText)
				.frame(width: 16)
				.accessibilityHidden(true)
			Text(title)
				.font(.caption.weight(.medium))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
		.accessibilityElement(children: .combine)
	}
}
