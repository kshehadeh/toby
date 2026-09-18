import SwiftUI

/// Optional titled group inside a settings catalog (for example Integrations
/// vs MCP servers). When `groups` is nil, `children` render as one untitled list.
struct SettingsCatalogGroup: Identifiable {
	let id: String
	var title: String? = nil
	var children: [SettingsItem]
	var emptyDescription: String? = nil
	var addTitle: String? = nil
	var addAccessibilityIdentifier: String = "settings-catalog-add-row"
	var onAdd: (() -> Void)? = nil
}

/// Inline TipKit card shown below catalog groups.
struct SettingsCatalogTip {
	var id: String
	var title: String
	var message: String
	var actionTitle: String? = nil
	var actionURL: URL? = nil
	var accessibilityId: String = "settings-catalog-tip"
}

/// Grouped Form catalog that pushes a section detail in a `NavigationStack`
/// while the Settings sidebar stays on the parent row (Integrations, AI, …).
struct SettingsCatalogView: View {
	@Bindable var store: ConfigureStore
	@Binding var path: [String]
	let title: String
	let subtitle: String
	let systemImage: String
	let children: [SettingsItem]
	let accessibilityCatalogId: String
	let accessibilityRowPrefix: String
	let fallbackIcon: String
	var loadingTitle: String = "Loading…"
	var unavailableTitle: String = "Unavailable"
	var emptyTitle: String = "Nothing here"
	var emptyDescription: String = "No items are available yet."
	var statusText: ((SettingsItem) -> String?)? = nil
	var onAdd: (() -> Void)? = nil
	var addTitle: String? = nil
	var groups: [SettingsCatalogGroup]? = nil
	var catalogTip: SettingsCatalogTip? = nil

	var body: some View {
		NavigationStack(path: $path) {
			catalog
				.navigationDestination(for: String.self) { key in
					childDetail(for: key)
						.navigationBarBackButtonHidden(true)
						.navigationTitle(childTitle(for: key))
				}
				.toolbar {
					if let onAdd {
						ToolbarItem(placement: .primaryAction) {
							Button(action: onAdd) {
								Label(addTitle ?? "Add", systemImage: "plus")
							}
							.accessibilityLabel(addTitle ?? "Add")
							.accessibilityIdentifier("settings-catalog-add")
						}
					}
				}
		}
	}

	@ViewBuilder
	private var catalog: some View {
		Group {
			if store.isLoading && children.isEmpty {
				ProgressView(loadingTitle)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let errorMessage = store.errorMessage, children.isEmpty {
				ContentUnavailableView {
					Label(unavailableTitle, systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if children.isEmpty, groups == nil {
				ContentUnavailableView {
					Label(emptyTitle, systemImage: systemImage)
				} description: {
					Text(emptyDescription)
				}
			} else {
				catalogForm
			}
		}
		.accessibilityIdentifier(accessibilityCatalogId)
	}

	private var resolvedGroups: [SettingsCatalogGroup] {
		if let groups { return groups }
		return [SettingsCatalogGroup(id: "catalog", children: children)]
	}

	private var catalogForm: some View {
		Form {
			Section {
				catalogHeader
					.frame(maxWidth: .infinity)
					.listRowBackground(Color.clear)
					.listRowInsets(EdgeInsets(top: 12, leading: 0, bottom: 8, trailing: 0))
			}

			ForEach(resolvedGroups) { group in
				catalogGroupSection(group)
			}

			if let catalogTip {
				Section {
					SetupTipCard(
						tipId: catalogTip.id,
						title: catalogTip.title,
						message: catalogTip.message,
						actionTitle: catalogTip.actionTitle,
						actionURL: catalogTip.actionURL,
						accessibilityId: catalogTip.accessibilityId
					)
				}
			}
		}
		.tobySettingsFormStyle()
		.tobyThemeRefreshable()
	}

	@ViewBuilder
	private func catalogGroupSection(_ group: SettingsCatalogGroup) -> some View {
		Section {
			catalogGroupRows(group)
		} header: {
			if let title = group.title {
				Text(title)
					.accessibilityIdentifier("settings-catalog-group-\(group.id)")
			}
		}
	}

	@ViewBuilder
	private func catalogGroupRows(_ group: SettingsCatalogGroup) -> some View {
		ForEach(group.children) { section in
			let key = ConfigureTreeHelpers.sectionIdentityKey(section)
			NavigationLink(value: key) {
				SettingsCatalogRow(
					section: section,
					statusText: statusText?(section),
					fallbackIcon: fallbackIcon
				)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("\(accessibilityRowPrefix)-\(key)")
		}
		if group.children.isEmpty, let emptyDescription = group.emptyDescription, group.onAdd == nil {
			Text(emptyDescription)
				.foregroundStyle(.secondary)
		}
		if let onAdd = group.onAdd, let addTitle = group.addTitle {
			SettingsCatalogAddRow(
				title: addTitle,
				accessibilityIdentifier: group.addAccessibilityIdentifier,
				action: onAdd
			)
		}
	}

	private var catalogHeader: some View {
		SettingsCatalogHeader(title: title, subtitle: subtitle, systemImage: systemImage)
	}

	@ViewBuilder
	private func childDetail(for key: String) -> some View {
		if store.sectionDetailLoading,
			store.settingsSelectedSection.map({ ConfigureTreeHelpers.sectionIdentityKey($0) }) != key
		{
			ConfigureDetailSkeletonView()
		} else if let section = store.settingsSelectedSection,
			ConfigureTreeHelpers.sectionIdentityKey(section) == key
		{
			ConfigureSectionDetailView(store: store, section: section)
		} else if let section = children.first(where: {
			ConfigureTreeHelpers.sectionIdentityKey($0) == key
		}) {
			ConfigureSectionDetailView(store: store, section: section)
		} else {
			ProgressView("Loading…")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private func childTitle(for key: String) -> String {
		if let section = store.settingsSelectedSection,
			ConfigureTreeHelpers.sectionIdentityKey(section) == key
		{
			return section.displayLabel
		}
		return children.first {
			ConfigureTreeHelpers.sectionIdentityKey($0) == key
		}?.displayLabel ?? title
	}

	static func subtitle(for key: String, section: SettingsItem?) -> String {
		if let description = section?.description, !description.isEmpty {
			return description
		}
		switch key {
		case SettingsItem.integrationsSectionKey:
			return "Connect services Toby can use in chat."
		case SettingsItem.aiSectionKey:
			return "Choose a provider Toby can use for chat."
		case SettingsItem.personasSectionKey:
			return SettingsItem.personasCatalogSubtitle
		default:
			return "Configure this section."
		}
	}
}

struct SettingsCatalogHeader: View {
	let title: String
	let subtitle: String
	let systemImage: String

	var body: some View {
		VStack(spacing: 10) {
			RoundedRectangle(cornerRadius: 16, style: .continuous)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 64, height: 64)
				.overlay {
					Image(systemName: systemImage)
						.font(.system(size: 28, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			Text(title)
				.font(.title2.weight(.semibold))
				.foregroundStyle(.primary)
			Text(subtitle)
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
		}
		.padding(.vertical, 8)
	}
}

struct SettingsCatalogAddRow: View {
	let title: String
	var accessibilityIdentifier: String = "settings-catalog-add-row"
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 10) {
				Image(systemName: "plus")
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.frame(width: 24, height: 24)
					.accessibilityHidden(true)
				Text(title)
					.foregroundStyle(AppTheme.accent)
				Spacer(minLength: 8)
			}
		}
		.buttonStyle(.plain)
		.accessibilityLabel(title)
		.accessibilityIdentifier(accessibilityIdentifier)
	}
}

struct SettingsCatalogRow: View {
	let section: SettingsItem
	let statusText: String?
	let fallbackIcon: String

	private var iconUrl: URL? {
		guard let iconUrl = section.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	var body: some View {
		HStack(spacing: 10) {
			iconView
				.frame(width: 24, height: 24)
			Text(section.displayLabel)
				.foregroundStyle(.primary)
			Spacer(minLength: 8)
			if let statusText, !statusText.isEmpty {
				Text(statusText)
					.font(.caption)
					.foregroundStyle(.secondary)
			}
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel(
			statusText.map { "\(section.displayLabel), \($0)" } ?? section.displayLabel
		)
	}

	@ViewBuilder
	private var iconView: some View {
		if let iconUrl {
			SidebarIconView(
				url: iconUrl,
				fallbackSystemName: fallbackIcon,
				isSelected: false
			)
			.frame(width: 20, height: 20)
		} else if let icon = section.icon, !icon.isEmpty {
			Text(icon)
				.font(.system(size: 16))
		} else if section.isMcpConnection {
			Image(systemName: "cable.connector")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(.secondary)
				.accessibilityHidden(true)
		} else {
			Image(systemName: fallbackIcon)
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(.secondary)
		}
	}
}
