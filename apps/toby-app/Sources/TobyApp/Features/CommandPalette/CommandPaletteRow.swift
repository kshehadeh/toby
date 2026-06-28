import SwiftUI

struct CommandPaletteRow: View {
	let result: CommandPaletteResult
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: result.systemImage)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 18)
			VStack(alignment: .leading, spacing: 2) {
				Text(result.title)
					.font(.callout)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(result.subtitle)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer()
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
	}
}
