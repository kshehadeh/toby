import SwiftUI

struct SkillsDetailView: View {
	@Bindable var store: SkillsStore

	var body: some View {
		GeometryReader { geo in
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					if store.isListLoading && store.skills.isEmpty {
						ProgressView("Loading skills…")
							.frame(maxWidth: .infinity, minHeight: 240)
					} else if let skill = store.selectedSkill {
						SkillDetailContent(store: store, skill: skill, availableHeight: geo.size.height)
					} else if let errorMessage = store.errorMessage, store.skills.isEmpty {
						ContentUnavailableView {
							Label("Skills unavailable", systemImage: "exclamationmark.triangle")
						} description: {
							Text(errorMessage)
						}
					} else {
						Text("Select a skill")
							.foregroundStyle(SettingsDesign.rowDescription)
					}

					if let errorMessage = store.errorMessage, !store.skills.isEmpty {
						Text(errorMessage)
							.font(.caption)
							.foregroundStyle(.red)
					}
				}
				.frame(maxWidth: SettingsDesign.contentMaxWidth)
				.frame(maxWidth: .infinity)
				.padding(.horizontal, 32)
				.padding(.vertical, 28)
			}
		}
		.background(SettingsDesign.canvasBackground)
	}
}
