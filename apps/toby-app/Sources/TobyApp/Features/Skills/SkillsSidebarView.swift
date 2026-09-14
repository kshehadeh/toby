import SwiftUI

struct SkillsSidebarView: View {
	@Bindable var store: SkillsStore
	let onDelete: (SkillListItem) -> Void

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isListLoading,
			isEmpty: store.skills.isEmpty,
			loadingText: "Loading skills…",
			emptyText: "No skills",
			onClearSelection: { store.selectHome() }
		) {
			ForEach(store.skills) { skill in
				Button {
					store.selectSkill(id: skill.id)
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
}
