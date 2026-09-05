import SwiftUI

struct SkillsSidebarView: View {
	@Bindable var store: SkillsStore
	let onDelete: (SkillListItem) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isListLoading && store.skills.isEmpty {
						Text("Loading skills…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.skills.isEmpty {
						Text("No skills")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.skills) { skill in
							Button {
								Task { await store.selectSkill(id: skill.id) }
							} label: {
								SkillSidebarRow(
									skill: skill,
									isSelected: store.selectedSkillId == skill.id,
								)
							}
							.buttonStyle(.plain)
							.contextMenu {
								Button("Delete Skill", systemImage: "trash", role: .destructive) {
									onDelete(skill)
								}
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)
		}
	}
}
