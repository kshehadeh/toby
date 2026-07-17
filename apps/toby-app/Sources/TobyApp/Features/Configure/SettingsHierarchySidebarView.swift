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
	@State private var isHovered = false

	private var navKey: String {
		ConfigureTreeHelpers.sectionIdentityKey(item)
	}

	private var isSelected: Bool {
		store.selectedNavKey == navKey
	}

	private var iconName: String {
		SettingsSidebarIcon.systemName(for: item)
	}

	private var iconColor: Color {
		if isSelected { return AppTheme.accent }
		if isHovered { return AppTheme.primaryText }
		return AppTheme.tertiaryText
	}

	private var labelColor: Color {
		if isSelected || isHovered { return AppTheme.primaryText }
		return AppTheme.secondaryText
	}

	private var backgroundFill: Color {
		if isSelected {
			// Accent wash + neutral selection so the row reads clearly in both
			// light and dark (plain white.opacity fills were nearly invisible).
			return AppTheme.accent.opacity(0.18)
		}
		if isHovered { return SettingsDesign.sidebarSelection.opacity(0.7) }
		return .clear
	}

	var body: some View {
		Button {
			store.selectSection(navKey)
		} label: {
			HStack(spacing: 10) {
				RoundedRectangle(cornerRadius: 1.5)
					.fill(isSelected ? AppTheme.accent : Color.clear)
					.frame(width: 3, height: 18)
					.accessibilityHidden(true)

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
							.foregroundStyle(iconColor)
					} else {
						Image(systemName: iconName)
							.font(.system(size: 14, weight: .semibold))
							.foregroundStyle(iconColor)
					}
				}
				.frame(width: 20, height: 20)
				.accessibilityHidden(true)

				Text(item.label)
					.font(.callout.weight(isSelected ? .semibold : .medium))
					.foregroundStyle(labelColor)
					.lineLimit(1)
				Spacer(minLength: 0)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.vertical, 8)
			.padding(.trailing, 8)
			.padding(.leading, 5)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: 8)
					.fill(backgroundFill)
			)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.accessibilityAddTraits(isSelected ? .isSelected : [])
	}
}
