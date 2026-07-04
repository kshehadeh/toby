import SwiftUI

struct SidebarSessionRow: View {
	let title: String
	let subtitle: String?
	var isSelected = false
	var isExternal = false
	var isAwaitingUser = false

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: isExternal ? "arrowshape.turn.up.left" : "message")
				.font(.callout)
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
			VStack(alignment: .leading, spacing: 1) {
				Text(title)
					.font(.callout)
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				if let subtitle {
					Text(subtitle)
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
			if isAwaitingUser {
				Image(systemName: "questionmark.bubble")
					.font(.caption2)
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.horizontal, 8)
		.padding(.vertical, 7)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
	}
}
