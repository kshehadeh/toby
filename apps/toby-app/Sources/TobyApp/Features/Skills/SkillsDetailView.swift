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
				SkillsHomeView(store: store)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}

struct SkillsHomeView: View {
	@Bindable var store: SkillsStore

	private let columns = [
		GridItem(.adaptive(minimum: 240, maximum: 360), spacing: 16),
	]

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				header
				LazyVGrid(columns: columns, spacing: 16) {
					ForEach(store.skills) { skill in
						Button {
							Task { await store.selectSkill(id: skill.id) }
						} label: {
							SkillCard(skill: skill)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("skill-card-\(skill.id)")
					}
				}
			}
			.padding(24)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("skills-home-view")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Skills")
				.font(.system(size: 24, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Reusable instructions that help Toby handle specialized work consistently. Select a skill to view or edit its instructions.")
				.font(.body)
				.foregroundStyle(SettingsDesign.rowDescription)
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

struct SkillCard: View {
	let skill: SkillListItem

	private var description: String {
		if !skill.summary.isEmpty {
			return skill.summary
		}
		if let description = skill.description, !description.isEmpty {
			return description
		}
		return "No description yet"
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .top, spacing: 12) {
				SkillIconView(iconURL: skill.resolvedIconURL, size: 40, cornerRadius: 10)
				VStack(alignment: .leading, spacing: 4) {
					Text(skill.name)
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
					Text(skill.enabled ? "Enabled" : "Disabled")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(skill.enabled ? .green : AppTheme.tertiaryText)
				}
				Spacer(minLength: 0)
			}

			Text(description)
				.font(.system(size: 12))
				.foregroundStyle(description == "No description yet" ? AppTheme.tertiaryText : SettingsDesign.rowDescription)
				.lineLimit(3)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.frame(minHeight: 48, alignment: .topLeading)

			HStack {
				Label("Reusable instructions", systemImage: "text.document")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.secondaryText)
				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityHidden(true)
			}
		}
		.padding(16)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
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
