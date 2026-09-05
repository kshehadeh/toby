import SwiftUI

struct SidebarActionItem: Identifiable, Equatable {
	let route: DetailRoute
	let title: String
	let systemImage: String
	let detail: String

	var id: DetailRoute { route }
}

struct AppSidebar<Content: View>: View {
	let currentRoute: DetailRoute
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isServerRestarting: Bool
	var isServerConnecting: Bool = false
	var serverLifecycleMessage: String? = nil
	var isRecordingActive: Bool = false
	var isRecordingProcessing: Bool = false
	let updateStore: UpdateStore?
	let onSelectRoute: (DetailRoute) -> Void
	@Binding var isPersonaPickerPresented: Bool
	var isPersonaAttentionHighlighted: Bool = false
	var emphasizeCreatePersona: Bool = false
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void
	let onCheckForUpdates: () -> Void
	let onRestartServer: () -> Void
	@ViewBuilder let sidebarContent: () -> Content

	private var actionItems: [SidebarActionItem] {
		[
			SidebarActionItem(
				route: .dashboard,
				title: "Home",
				systemImage: "house",
				detail: "See what needs your attention: unread mail, open tasks, and setup steps at a glance."
			),
			SidebarActionItem(
				route: .chat,
				title: "Chats",
				systemImage: "message",
				detail: "Open your chat workspace, continue existing conversations, or start a new session with Toby."
			),
			SidebarActionItem(
				route: .integrations,
				title: "Integrations",
				systemImage: "square.grid.2x2",
				detail: "Manage connected services, credentials, setup guides, and integration-specific capabilities."
			),
			SidebarActionItem(
				route: .projects,
				title: "Projects",
				systemImage: "folder",
				detail: "Work inside project folders with scoped chats, local guidance, skills, and generated outputs."
			),
			SidebarActionItem(
				route: .skills,
				title: "Skills",
				systemImage: "wand.and.stars",
				detail: "Browse installed skills, inspect their instructions, edit them, or add new reusable workflows."
			),
			SidebarActionItem(
				route: .schedules,
				title: "Schedules",
				systemImage: "clock",
				detail: "Create and monitor recurring prompts that run on a schedule through Toby's background daemon."
			),
			SidebarActionItem(
				route: .flows,
				title: "Flows",
				systemImage: "arrow.triangle.branch",
				detail: "Browse named flow pipelines, inspect their nodes, and review recent execution history."
			),
			SidebarActionItem(
				route: .recordings,
				title: "Recordings",
				systemImage: "waveform",
				detail: "Review audio recordings, transcripts, and chats created from recorded context."
			),
		]
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarHeader(
				status: status,
				daemonStatus: daemonStatus,
				isServerRestarting: isServerRestarting,
				isServerConnecting: isServerConnecting,
				serverLifecycleMessage: serverLifecycleMessage,
				isRecordingActive: isRecordingActive,
				isRecordingProcessing: isRecordingProcessing,
				updateStore: updateStore,
				onCheckForUpdates: onCheckForUpdates,
				onRestartServer: onRestartServer
			)
			SidebarWorkspaceMenu(
				currentRoute: currentRoute,
				items: actionItems,
				onSelectRoute: onSelectRoute
			)
			.padding(.bottom, 10)
			sidebarContent()
				.frame(maxHeight: .infinity, alignment: .topLeading)
				.padding(.bottom, 16)
			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)
				.padding(.vertical, 2)
			SidebarFooter(
				status: status,
				isPersonaPickerPresented: $isPersonaPickerPresented,
				isAttentionHighlighted: isPersonaAttentionHighlighted,
				emphasizeCreatePersona: emphasizeCreatePersona,
				onCreatePersona: onCreatePersona,
				onEditPersona: onEditPersona,
				onPersonaSelected: onPersonaSelected,
			)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 12)
		.frame(minWidth: AppTheme.minSidebarWidth, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(AppTheme.sidebarBackground)
		// Session rows / grid actions live in lazy stacks and need a theme epoch
		// nudge to re-tint without resetting Settings tab or navigation state.
		.tobyThemeRefreshable()
		.environment(AppearancePreferences.shared)
		.accessibilityIdentifier("app-sidebar")
	}
}

struct SidebarWorkspaceMenu: View {
	let currentRoute: DetailRoute
	let items: [SidebarActionItem]
	let onSelectRoute: (DetailRoute) -> Void

	var body: some View {
		Menu {
			ForEach(items) { item in
				Button {
					onSelectRoute(item.route)
				} label: {
					Label(item.title, systemImage: item.systemImage)
				}
				.accessibilityLabel(item.title)
				.accessibilityHint(item.detail)
			}
		} label: {
			Label(currentRoute.menuTitle, systemImage: currentRoute.systemImage)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
		.menuStyle(.borderlessButton)
		.accessibilityLabel("Workspace")
		.accessibilityValue(currentRoute.menuTitle)
		.accessibilityHint("Choose a Toby workspace")
		.accessibilityIdentifier("sidebar-workspace-menu")
	}
}

/// Inner content for a system `.popover` (same chrome as the server-status button).
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
