import SwiftUI

struct SkillDetailContent: View {
	@Bindable var store: SkillsStore
	let skill: SkillDetail

	var body: some View {
		VStack(spacing: 0) {
			SkillDetailHeader(skill: skill)
				.padding(.horizontal, 24)
				.padding(.vertical, 18)

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 0) {
				instructionsColumn
				Divider().overlay(SettingsDesign.cardBorder)
				SkillInspectorSidebar(store: store, skill: skill)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	private var instructionsColumn: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Instructions")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Sent to the model when this skill runs")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			SkillMarkdownEditor(text: binding(for: .body))
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.padding(.top, 8)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private func binding(for field: SkillField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: skill.dirName, field: field)) },
			set: { store.setDraftValue(store.key(for: skill.dirName, field: field), $0) },
		)
	}
}

extension SkillDetail {
	/// Full URL for the skill's custom icon, with a cache-busting token so
	/// re-uploads (which reuse the `icon.png` filename) reload in the UI.
	var resolvedIconURL: URL? {
		guard let iconUrl, !iconUrl.isEmpty else { return nil }
		let base = ConfigReader.baseURL().absoluteString
		let token = (updatedAt ?? "")
			.unicodeScalars
			.filter { CharacterSet.alphanumerics.contains($0) }
			.map(String.init)
			.joined()
		let suffix = token.isEmpty ? "" : "?v=\(token)"
		return URL(string: base + iconUrl + suffix)
	}
}
