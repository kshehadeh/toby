import AppKit
import SwiftUI

struct AppSidebar<Content: View>: View {
	let currentRoute: DetailRoute
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isServerRestarting: Bool
	let updateStore: UpdateStore?
	let onSelectRoute: (DetailRoute) -> Void
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void
	let onOpenChangelog: () -> Void
	let onRestartServer: () -> Void
	@ViewBuilder let sidebarContent: () -> Content

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarHeader(
				status: status,
				daemonStatus: daemonStatus,
				isServerRestarting: isServerRestarting,
				updateStore: updateStore,
				onOpenChangelog: onOpenChangelog,
				onRestartServer: onRestartServer
			)
			sidebarContent()
				.frame(maxHeight: .infinity, alignment: .topLeading)
				.padding(.bottom, 16)
			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)
				.padding(.vertical, 2)
			VStack(alignment: .leading, spacing: 4) {
				Button {
					onSelectRoute(.chat)
				} label: {
					SidebarRow(title: "Chats", systemImage: "message", isSelected: currentRoute == .chat)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.integrations)
				} label: {
					SidebarRow(title: "Integrations", systemImage: "square.grid.2x2", isSelected: currentRoute == .integrations)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.skills)
				} label: {
					SidebarRow(title: "Skills", systemImage: "wand.and.stars", isSelected: currentRoute == .skills)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.schedules)
				} label: {
					SidebarRow(title: "Schedules", systemImage: "clock", isSelected: currentRoute == .schedules)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.recordings)
				} label: {
					SidebarRow(title: "Recordings", systemImage: "waveform", isSelected: currentRoute == .recordings)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
				Button {
					onSelectRoute(.settings)
				} label: {
					SidebarRow(title: "Settings", systemImage: "gearshape", isSelected: currentRoute == .settings)
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.padding(.top, 6)
			.padding(.bottom, 8)
			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)
				.padding(.vertical, 2)
			SidebarFooter(
				status: status,
				onCreatePersona: onCreatePersona,
				onEditPersona: onEditPersona,
				onPersonaSelected: onPersonaSelected,
			)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 12)
		.frame(minWidth: AppTheme.minSidebarWidth, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(AppTheme.sidebarBackground)
		.accessibilityIdentifier("app-sidebar")
	}
}
