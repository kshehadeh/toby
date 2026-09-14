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
						.id(skill.dirName)
					if let errorMessage = store.errorMessage, !store.skills.isEmpty {
						InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
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
				FeatureBrowserPlaceholder(
					systemImage: DetailRoute.skills.systemImage,
					prompt: "Select a skill",
					onCreate: { Task { await store.createSkill() } },
					createAccessibilityIdentifier: "empty-create-skill-button"
				)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
	}
}
