import SwiftUI

enum SkillDetailTab: String, Hashable, CaseIterable {
	case about
	case instructions
}

struct SkillDetailContent: View {
	@Bindable var store: SkillsStore
	let skill: SkillDetail

	var body: some View {
		TabView(selection: $store.selectedDetailTab) {
			Tab(value: SkillDetailTab.about) {
				SkillAboutPane(skill: skill)
			} label: {
				Text("About")
			}
			Tab(value: SkillDetailTab.instructions) {
				SkillInstructionsPane(skill: skill)
			} label: {
				Text("Instructions")
			}
		}
		.padding(AppTheme.contentPadding)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("skill-detail-tabs")
	}
}

struct SkillAboutPane: View {
	let skill: SkillDetail

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				HStack(alignment: .center, spacing: 12) {
					SkillIconView(iconURL: skill.resolvedIconURL, size: 48, cornerRadius: 12)
					DetailHeading(
						title: skill.name,
						accessibilityIdentifier: "skill-detail-name"
					)
				}

				if !skill.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					DetailSection(title: "Summary") {
						Text(skill.summary)
							.font(.system(size: 13))
							.foregroundStyle(SettingsDesign.rowTitle)
							.fixedSize(horizontal: false, vertical: true)
							.textSelection(.enabled)
					}
				}

				VStack(alignment: .leading, spacing: 12) {
					DetailMetadataRow(
						label: "Enabled",
						value: skill.enabled ? "Offered to the model" : "Hidden from the model"
					)
					if let created = formattedDate(skill.createdAt) {
						DetailMetadataRow(label: "Created", value: created)
					}
					if let edited = formattedDate(skill.updatedAt) {
						DetailMetadataRow(label: "Edited", value: edited)
					}
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth + 80)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("skill-about-tab")
	}

	private func formattedDate(_ iso: String?) -> String? {
		guard let iso, !iso.isEmpty else { return nil }
		let parser = ISO8601DateFormatter()
		parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
		guard let date else { return nil }
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .short
		return formatter.string(from: date)
	}
}

struct SkillInstructionsPane: View {
	let skill: SkillDetail

	var body: some View {
		Group {
			if skill.bodyMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				ContentUnavailableView {
					Label {
						Text("No instructions")
					} icon: {
						Image(systemName: "doc.text")
							.accessibilityHidden(true)
					}
				} description: {
					Text("Add instructions in Edit Skill.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else {
				VStack(alignment: .leading, spacing: 8) {
					Text("Sent to the model when this skill runs")
						.font(.caption)
						.foregroundStyle(SettingsDesign.rowDescription)
					ScrollView {
						MarkdownText(
							text: skill.bodyMarkdown,
							font: .body,
							foregroundStyle: SettingsDesign.rowTitle
						)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
					}
					.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("skill-instructions-tab")
	}
}
