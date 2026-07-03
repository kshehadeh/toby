import SwiftUI

/// Card-based layout for the Default Providers configuration page.
/// Each provider category gets a card with an icon, title, description,
/// and a dropdown to select the associated integration plugin.
struct DefaultProviderCardsView: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem

	private var providerFields: [SettingsItem] {
		(section.children ?? []).filter { $0.kind == .select }
	}

	private let columns = [
		GridItem(.flexible(), spacing: 16),
		GridItem(.flexible(), spacing: 16),
	]

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			VStack(alignment: .leading, spacing: 6) {
				Text("Default Providers")
					.font(.title2.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text("Choose which integration handles each category of data when multiple are connected.")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
			}

			LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
				ForEach(providerFields, id: \.id) { field in
					DefaultProviderCard(store: store, field: field)
				}
			}
		}
	}
}

private struct DefaultProviderCard: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem

	private var categoryIcon: String {
		DefaultProviderIcon.systemName(for: field.key)
	}

	private var choices: [SettingsSelectChoice] {
		if let selectChoices = field.selectChoices, !selectChoices.isEmpty {
			return selectChoices
		}
		return field.options?.map {
			SettingsSelectChoice(value: $0, label: store.integrationLabels[$0] ?? $0)
		} ?? []
	}

	private var selectionBinding: Binding<String> {
		Binding(
			get: { store.value(for: field.key) },
			set: { store.setDraftValue(field.key, $0, autosaveImmediately: true) },
		)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(AppTheme.accent.opacity(0.15))
					.frame(width: 44, height: 44)
					.overlay {
						Image(systemName: categoryIcon)
							.font(.system(size: 20, weight: .medium))
							.foregroundStyle(AppTheme.accent)
					}

				Text(field.label)
					.font(.headline)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
			}

			if let description = field.description, !description.isEmpty {
				Text(description)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
					.lineLimit(3)
			}

			Spacer(minLength: 0)

			HStack {
				Text("Plugin")
					.font(.subheadline)
					.foregroundStyle(AppTheme.tertiaryText)
				Spacer()
				SettingsSelectChoiceField(
					title: field.label,
					choices: choices,
					selection: selectionBinding,
				)
			}
		}
		.padding(18)
		.frame(maxWidth: .infinity, alignment: .leading)
		.frame(minHeight: 170)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}

enum DefaultProviderIcon {
	static func systemName(for key: String) -> String {
		let lower = key.lowercased()
		if lower.contains("email") { return "envelope" }
		if lower.contains("calendar") { return "calendar" }
		if lower.contains("tasks") { return "checklist" }
		if lower.contains("contacts") { return "person.crop.circle" }
		if lower.contains("chat") { return "bubble.left.and.bubble.right" }
		if lower.contains("search") { return "magnifyingglass" }
		if lower.contains("work") || lower.contains("tracker") { return "chart.bar" }
		return "gearshape"
	}
}
