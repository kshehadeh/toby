import SwiftUI

struct ConfigureSidebarNodeView: View {
	@Bindable var store: ConfigureStore
	let node: SidebarTreeNode

	private var isSelected: Bool {
		store.selectedNavKey == node.navKey
	}

	private var iconName: String {
		SettingsSidebarIcon.systemName(for: node.item)
	}

	private var iconView: some View {
		Group {
			if let iconUrl = node.item.iconUrl,
				let url = URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
			{
				SidebarIconView(url: url, fallbackSystemName: "sparkles", isSelected: isSelected)
			} else {
				Image(systemName: iconName)
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
			}
		}
		.frame(width: 20, height: 20)
		.accessibilityHidden(true)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			HStack(spacing: 8) {
				Button {
					store.selectSection(node.navKey)
				} label: {
					HStack(spacing: 12) {
						iconView
						Text(node.item.label)
							.font(.callout.weight(.medium))
							.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
							.lineLimit(1)
						Spacer(minLength: 0)
					}
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.vertical, 8)
					.padding(.horizontal, 8)
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)

				if !node.children.isEmpty {
					Button {
						store.toggleExpanded(node.navKey)
					} label: {
						Image(systemName: "chevron.right")
							.font(.caption2.weight(.semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.rotationEffect(.degrees(store.expandedKeys.contains(node.navKey) ? 90 : 0))
							.frame(width: 16, height: 20)
							.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
					.padding(.trailing, 6)
				}
			}
			.background(
				RoundedRectangle(cornerRadius: 8)
					.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
			)

			if store.expandedKeys.contains(node.navKey) {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(node.children) { child in
						ConfigureSidebarNodeView(store: store, node: child)
							.padding(.leading, 14)
					}
				}
			}
		}
	}
}
