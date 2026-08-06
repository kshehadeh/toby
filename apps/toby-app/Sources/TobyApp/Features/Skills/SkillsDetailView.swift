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
			} else if store.skills.isEmpty {
				SkillsEmptyStateView(store: store)
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

private struct SkillsEmptyStateView: View {
	@Bindable var store: SkillsStore

	var body: some View {
		VStack(spacing: 18) {
			Image(systemName: "sparkles.rectangle.stack")
				.font(.system(size: 72, weight: .regular))
				.foregroundStyle(SettingsDesign.rowDescription)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Skills")
					.font(.system(size: 28, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Skills are reusable instructions that teach Toby how to handle specialized work consistently across chats and automations.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(3)
					.frame(maxWidth: 480)
			}

			Button {
				Task { await store.createSkill() }
			} label: {
				Label("Create Skill", systemImage: "plus")
			}
			.buttonStyle(.borderedProminent)
			.disabled(store.isListLoading || store.isSaving)
			.accessibilityIdentifier("empty-create-skill-button")
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
	}
}
