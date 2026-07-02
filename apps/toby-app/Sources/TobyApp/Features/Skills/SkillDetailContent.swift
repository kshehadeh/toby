import SwiftUI

struct SkillDetailContent: View {
	@Bindable var store: SkillsStore
	let skill: SkillDetail
	let availableHeight: CGFloat

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			SkillDetailHeader(skill: skill)

			SettingsSectionHeader(title: "Details")
			SettingsCard {
				SkillFieldRow(title: "Name") {
					SettingsInlineField(text: binding(for: .name), placeholder: "Skill name")
				}
				SkillFieldRow(title: "Description", showsDivider: false) {
					SettingsInlineField(text: binding(for: .description), placeholder: "Short description")
				}
			}

			SettingsSectionHeader(title: "Description")
			MarkdownEditor(text: binding(for: .body))
				.frame(minHeight: max(240, availableHeight - 300), maxHeight: .infinity)
		}
	}

	private func binding(for field: SkillField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: skill.dirName, field: field)) },
			set: { store.setDraftValue(store.key(for: skill.dirName, field: field), $0) },
		)
	}
}
