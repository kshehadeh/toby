import SwiftUI

struct SkillsDetailView: View {
	@Bindable var store: SkillsStore

	var body: some View {
		Group {
			if store.isListLoading && store.skills.isEmpty {
				ProgressView("Loading skills…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let skill = store.selectedSkill {
				VStack(spacing: 0) {
					SkillDetailContent(store: store, skill: skill)
					if let errorMessage = store.errorMessage, !store.skills.isEmpty {
						Text(errorMessage)
							.font(.caption)
							.foregroundStyle(.red)
							.frame(maxWidth: .infinity, alignment: .leading)
							.padding(.horizontal, 24)
							.padding(.bottom, 12)
					}
				}
			} else if let errorMessage = store.errorMessage, store.skills.isEmpty {
				ContentUnavailableView {
					Label("Skills unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else {
				Text("Select a skill")
					.foregroundStyle(SettingsDesign.rowDescription)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}
