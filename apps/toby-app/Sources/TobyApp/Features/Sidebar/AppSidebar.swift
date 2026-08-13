import AppKit
import SwiftUI

enum RootContentCoordinateSpace {
	static let name = "root-content-coordinate-space"
}

struct SidebarActionItem: Identifiable, Equatable {
	let route: DetailRoute
	let title: String
	let systemImage: String
	let hoveredSystemImage: String
	let accentColor: Color
	let detail: String

	var id: DetailRoute { route }
}

struct SidebarActionHelpPresentation: Equatable {
	let item: SidebarActionItem
	let buttonFrame: CGRect
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
	var onActionHelpChange: (SidebarActionHelpPresentation?) -> Void = { _ in }
	@ViewBuilder let sidebarContent: () -> Content

	private var actionItems: [SidebarActionItem] {
		[
			SidebarActionItem(
				route: .dashboard,
				title: "Dashboard",
				systemImage: "rectangle.3.group",
				hoveredSystemImage: "rectangle.3.group.fill",
				accentColor: AppTheme.accent,
				detail: "See what needs your attention: unread mail, open tasks, and setup steps at a glance."
			),
			SidebarActionItem(
				route: .chat,
				title: "Chats",
				systemImage: "message",
				hoveredSystemImage: "message.fill",
				accentColor: Color(red: 0.35, green: 0.68, blue: 1),
				detail: "Open your chat workspace, continue existing conversations, or start a new session with Toby."
			),
			SidebarActionItem(
				route: .integrations,
				title: "Integrations",
				systemImage: "square.grid.2x2",
				hoveredSystemImage: "square.grid.2x2.fill",
				accentColor: Color(red: 0.32, green: 0.82, blue: 0.48),
				detail: "Manage connected services, credentials, setup guides, and integration-specific capabilities."
			),
			SidebarActionItem(
				route: .projects,
				title: "Projects",
				systemImage: "folder",
				hoveredSystemImage: "folder.fill",
				accentColor: Color(red: 0.95, green: 0.7, blue: 0.28),
				detail: "Work inside project folders with scoped chats, local guidance, skills, and generated outputs."
			),
			SidebarActionItem(
				route: .skills,
				title: "Skills",
				systemImage: "wand.and.stars",
				hoveredSystemImage: "wand.and.stars",
				accentColor: Color(red: 0.72, green: 0.52, blue: 1),
				detail: "Browse installed skills, inspect their instructions, edit them, or add new reusable workflows."
			),
			SidebarActionItem(
				route: .memories,
				title: "Memories",
				systemImage: "brain.head.profile",
				hoveredSystemImage: "brain.head.profile",
				accentColor: Color(red: 0.92, green: 0.58, blue: 0.86),
				detail: "Browse, create, edit, and delete memories Toby remembers across chats and automations."
			),
			SidebarActionItem(
				route: .schedules,
				title: "Schedules",
				systemImage: "clock",
				hoveredSystemImage: "clock.fill",
				accentColor: AppTheme.accent,
				detail: "Create and monitor recurring prompts that run on a schedule through Toby's background daemon."
			),
			SidebarActionItem(
				route: .flows,
				title: "Flows",
				systemImage: "arrow.triangle.branch",
				hoveredSystemImage: "arrow.triangle.branch",
				accentColor: Color(red: 0.38, green: 0.72, blue: 0.86),
				detail: "Browse named flow pipelines, inspect their nodes, and review recent execution history."
			),
			SidebarActionItem(
				route: .recordings,
				title: "Recordings",
				systemImage: "waveform",
				hoveredSystemImage: "waveform",
				accentColor: Color(red: 1, green: 0.36, blue: 0.42),
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
			sidebarContent()
				.frame(maxHeight: .infinity, alignment: .topLeading)
				.padding(.bottom, 16)
			Divider()
				.background(AppTheme.separator)
				.opacity(0.5)
				.padding(.vertical, 2)
			LazyVGrid(
				columns: [
					GridItem(.flexible(), spacing: 6),
					GridItem(.flexible(), spacing: 6),
					GridItem(.flexible(), spacing: 6),
				],
				spacing: 6
			) {
				ForEach(actionItems) { item in
					SidebarActionGridButton(
						item: item,
						isSelected: currentRoute == item.route
					) {
						onSelectRoute(item.route)
					} onHelpChange: { presentation in
						onActionHelpChange(presentation)
					}
				}
			}
			.padding(.top, 6)
			.padding(.bottom, 8)
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
		.accessibilityIdentifier("app-sidebar")
	}
}

private struct SidebarActionGridButton: View {
	let item: SidebarActionItem
	let isSelected: Bool
	let action: () -> Void
	let onHelpChange: (SidebarActionHelpPresentation?) -> Void

	@State private var isHovered = false
	@State private var isHelpVisible = false
	@State private var hoverWorkItem: DispatchWorkItem?
	@State private var buttonFrame = CGRect.zero

	var body: some View {
		GeometryReader { proxy in
			Button(action: action) {
				Image(systemName: isHovered ? item.hoveredSystemImage : item.systemImage)
					.font(.system(size: 18, weight: .medium))
					.symbolRenderingMode(isHovered ? .palette : .monochrome)
					.foregroundStyle(iconPrimaryStyle, iconSecondaryStyle)
					.frame(maxWidth: .infinity, minHeight: 34)
					.contentShape(RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius))
					.background(
						RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
							.fill(backgroundFill)
					)
			}
			.buttonStyle(.plain)
			.onHover(perform: handleHover)
			.onAppear {
				buttonFrame = proxy.frame(in: .named(RootContentCoordinateSpace.name))
			}
			.onChange(of: proxy.frame(in: .named(RootContentCoordinateSpace.name))) { _, frame in
				buttonFrame = frame
				if isHelpVisible {
					onHelpChange(SidebarActionHelpPresentation(item: item, buttonFrame: frame))
				}
			}
			.accessibilityLabel(item.title)
			.accessibilityHint(item.detail)
		}
		.frame(maxWidth: .infinity, minHeight: 34)
	}

	private var backgroundFill: Color {
		if isSelected { return item.accentColor.opacity(0.22) }
		return item.accentColor.opacity(isHovered ? 0.18 : 0)
	}

	private var iconPrimaryStyle: Color {
		if isHovered { return item.accentColor }
		if isSelected { return item.accentColor }
		return AppTheme.secondaryText
	}

	private var iconSecondaryStyle: Color {
		if isHovered { return AppTheme.primaryText }
		if isSelected { return item.accentColor }
		return AppTheme.secondaryText
	}

	private func handleHover(_ hovering: Bool) {
		isHovered = hovering
		hoverWorkItem?.cancel()

		if hovering {
			let workItem = DispatchWorkItem {
				withAnimation(.easeOut(duration: 0.12)) {
					isHelpVisible = true
				}
				onHelpChange(SidebarActionHelpPresentation(item: item, buttonFrame: buttonFrame))
			}
			hoverWorkItem = workItem
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: workItem)
		} else {
			withAnimation(.easeOut(duration: 0.08)) {
				isHelpVisible = false
			}
			onHelpChange(nil)
			hoverWorkItem = nil
		}
	}
}

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
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(AppTheme.elevatedBackground)
				.shadow(color: .black.opacity(0.28), radius: 14, x: 0, y: 8)
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
	}
}
