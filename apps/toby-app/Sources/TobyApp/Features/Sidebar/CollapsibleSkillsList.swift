import SwiftUI

struct CollapsibleSkillsList: View {
	let skills: [SkillSummary]
	@State private var isExpanded = false

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button {
				withAnimation(.easeInOut(duration: 0.2)) {
					isExpanded.toggle()
				}
			} label: {
				HStack(spacing: 8) {
					Text("Skills")
						.font(.caption)
						.foregroundStyle(AppTheme.secondaryText)
					Spacer()
					Text("\(skills.count)")
						.font(.caption)
						.foregroundStyle(AppTheme.primaryText)
					Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
						.accessibilityLabel(isExpanded ? "Collapse" : "Expand")
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Skills, \(skills.count) available")
			if isExpanded {
				VStack(alignment: .leading, spacing: 4) {
					ForEach(skills) { skill in
						Text(skill.name)
							.font(.caption)
							.foregroundStyle(AppTheme.primaryText)
							.lineLimit(1)
							.help(skill.description ?? "")
					}
				}
				.padding(.leading, 8)
				.padding(.top, 2)
			}
		}
	}
}
