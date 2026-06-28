import SwiftUI

struct SkillDetailHeader: View {
	let skill: SkillDetail

	var body: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "wand.and.stars")
						.font(.system(size: 22, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			VStack(alignment: .leading, spacing: 4) {
				Text(skill.name)
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				if !skill.description.isEmpty {
					Text(skill.description)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.lineLimit(2)
				}
			}
		}
	}
}
