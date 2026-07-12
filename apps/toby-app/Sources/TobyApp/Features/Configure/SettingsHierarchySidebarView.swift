import SwiftUI

/// Flat sidebar of nested settings sections (e.g. AI providers) shown inside
/// a hierarchical Settings toolbar tab.
struct SettingsHierarchySidebarView: View {
	@Bindable var store: ConfigureStore
	let parent: SettingsItem

	private var children: [SettingsItem] {
		ConfigureTreeHelpers.nestedSectionChildren(of: parent)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text(parent.label)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 12)
				.padding(.top, 12)
				.padding(.bottom, 6)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(children, id: \.id) { child in
						SettingsHierarchyRow(
							store: store,
							item: child,
						)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, 8)
				.padding(.bottom, 10)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(AppTheme.sidebarBackground)
	}
}

private struct SettingsHierarchyRow: View {
	@Bindable var store: ConfigureStore
	let item: SettingsItem

	private var navKey: String {
		ConfigureTreeHelpers.sectionIdentityKey(item)
	}

	private var isSelected: Bool {
		store.selectedNavKey == navKey
	}

	private var iconName: String {
		SettingsSidebarIcon.systemName(for: item)
	}

	var body: some View {
		Button {
			store.selectSection(navKey)
		} label: {
			HStack(spacing: 12) {
				Group {
					if let iconUrl = item.iconUrl,
						let url = URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
					{
						SidebarIconView(
							url: url,
							fallbackSystemName: iconName,
							isSelected: isSelected,
						)
					} else if let icon = item.icon, !icon.isEmpty {
						Image(systemName: icon)
							.font(.system(size: 14, weight: .semibold))
							.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
					} else {
						Image(systemName: iconName)
							.font(.system(size: 14, weight: .semibold))
							.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
					}
				}
				.frame(width: 20, height: 20)
				.accessibilityHidden(true)

				Text(item.label)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Spacer(minLength: 0)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.vertical, 8)
			.padding(.horizontal, 8)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: 8)
					.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
			)
		}
		.buttonStyle(.plain)
	}
}
