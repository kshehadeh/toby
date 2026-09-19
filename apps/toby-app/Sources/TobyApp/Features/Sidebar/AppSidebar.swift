import SwiftUI

struct AppSidebar: View {
	let currentRoute: DetailRoute
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isServerRestarting: Bool
	var isServerConnecting: Bool = false
	var serverLifecycleMessage: String? = nil
	let onSelectRoute: (DetailRoute) -> Void
	@Binding var isPersonaPickerPresented: Bool
	var isPersonaAttentionHighlighted: Bool = false
	var emphasizeCreatePersona: Bool = false
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void
	let onRestartServer: () -> Void
	var updateStore: UpdateStore? = nil

	@SceneStorage("sidebar.automationExpanded") private var automationExpanded = true
	@SceneStorage("sidebar.toolsExpanded") private var toolsExpanded = true

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			List(selection: selectionBinding) {
				ForEach(DetailRoute.sidebarPrimary) { route in
					destinationRow(route)
				}

				Section("Automation", isExpanded: $automationExpanded) {
					ForEach(DetailRoute.sidebarAutomation) { route in
						destinationRow(route)
					}
				}

				Section("Tools", isExpanded: $toolsExpanded) {
					ForEach(DetailRoute.sidebarTools) { route in
						destinationRow(route)
					}
				}
			}
			.listStyle(.sidebar)
			.scrollContentBackground(.hidden)
			.accessibilityIdentifier("sidebar-destination-list")

			if let updateStore, updateStore.shouldShowUpdateTip {
				UpdateAvailableTipCard(updateStore: updateStore)
			}

			SidebarConnectionStatus(
				status: status,
				daemonStatus: daemonStatus,
				isRestarting: isServerRestarting,
				isConnecting: isServerConnecting,
				lifecycleMessage: serverLifecycleMessage,
				onRestart: onRestartServer
			)

			SidebarFooter(
				status: status,
				daemonStatus: daemonStatus,
				isServerRestarting: isServerRestarting,
				isServerConnecting: isServerConnecting,
				serverLifecycleMessage: serverLifecycleMessage,
				isPersonaPickerPresented: $isPersonaPickerPresented,
				isAttentionHighlighted: isPersonaAttentionHighlighted,
				emphasizeCreatePersona: emphasizeCreatePersona,
				onCreatePersona: onCreatePersona,
				onEditPersona: onEditPersona,
				onPersonaSelected: onPersonaSelected,
				onRestartServer: onRestartServer
			)
			.padding(.horizontal, 8)
			.padding(.vertical, 8)
		}
		.frame(minWidth: AppTheme.minSidebarWidth, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.tobyThemeRefreshable()
		.environment(AppearancePreferences.shared)
		.accessibilityIdentifier("app-sidebar")
	}

	private var selectionBinding: Binding<DetailRoute?> {
		Binding(
			get: { currentRoute },
			set: { newValue in
				guard let newValue else { return }
				onSelectRoute(newValue)
			}
		)
	}

	private func destinationRow(_ route: DetailRoute) -> some View {
		Label(route.menuTitle, systemImage: route.systemImage)
			.tag(route)
			.tint(AppTheme.secondaryText)
			.accessibilityHint(route.sidebarHint)
			.accessibilityIdentifier("sidebar-destination-\(route.rawValue)")
			.overlay {
				if route == currentRoute {
					Color.clear
						.contentShape(Rectangle())
						.onTapGesture {
							onSelectRoute(route)
						}
						.accessibilityHidden(true)
				}
			}
	}
}

/// Inner content for a system `.popover` (dashboard action help, server-status chrome).
struct SidebarActionHelpPopover: View {
	let title: String
	let detail: String

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text(title)
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Text(detail)
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)
		}
		.padding(14)
		.frame(width: 260, alignment: .leading)
	}
}
