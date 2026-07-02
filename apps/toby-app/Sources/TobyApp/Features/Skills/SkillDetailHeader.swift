import SwiftUI

struct SkillDetailHeader: View {
	let skill: SkillDetail

	var body: some View {
		HStack(alignment: .center, spacing: 14) {
			SkillIconView(iconURL: skill.resolvedIconURL, size: 56, cornerRadius: 13)

			VStack(alignment: .leading, spacing: 4) {
				Text(skill.name)
					.font(.system(size: 20, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				if !skill.description.isEmpty {
					Text(skill.description)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.lineLimit(2)
				}
			}

			Spacer(minLength: 12)

			SkillStatusPill(enabled: skill.enabled)
		}
	}
}

struct SkillStatusPill: View {
	let enabled: Bool

	var body: some View {
		HStack(spacing: 6) {
			Circle()
				.fill(enabled ? Color.green : AppTheme.tertiaryText)
				.frame(width: 6, height: 6)
			Text(enabled ? "Enabled" : "Disabled")
				.font(.system(size: 12, weight: .medium))
				.foregroundStyle(enabled ? AppTheme.primaryText : AppTheme.secondaryText)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 5)
		.background(Color.white.opacity(0.05))
		.clipShape(Capsule())
		.overlay {
			Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1)
		}
	}
}
