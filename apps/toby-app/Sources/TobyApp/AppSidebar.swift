import SwiftUI

struct AppSidebar: View {
	let sessions: [SessionSummary]
	let selectedSessionId: String?
	let status: AppStatus?
	let isLoading: Bool
	let isSessionsLoading: Bool
	let onNewChat: () -> Void
	let onSearch: () -> Void
	let onSelectSession: (String) -> Void
	let onOpenSettings: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarHeader(status: status)
			SidebarPrimaryActions(
				onNewChat: onNewChat,
				onSearch: onSearch,
				isLoading: isLoading,
			)
			SidebarSection(title: "Workspace") {
				if isSessionsLoading && sessions.isEmpty {
					Text("Loading sessions…")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(.horizontal, 8)
						.padding(.vertical, 7)
				} else if sessions.isEmpty {
					Text("No past sessions")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(.horizontal, 8)
						.padding(.vertical, 7)
				} else {
					ScrollView {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(sessions) { session in
								Button {
									onSelectSession(session.id)
								} label: {
									SidebarRow(
										title: session.name,
										systemImage: "message",
										isSelected: session.id == selectedSessionId,
									)
								}
								.buttonStyle(.plain)
								.frame(maxWidth: .infinity, alignment: .leading)
								.disabled(isLoading)
							}
						}
					}
					.frame(maxHeight: 220)
				}
				SidebarRow(title: "Server event log", systemImage: "doc.text.magnifyingglass")
			}
			SidebarSection(title: "Toby") {
				SidebarRow(title: "Plugins", systemImage: "square.grid.2x2")
				SidebarRow(title: "Schedules", systemImage: "clock")
				Button(action: onOpenSettings) {
					SidebarRow(title: "Settings", systemImage: "gearshape")
				}
				.buttonStyle(.plain)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			Spacer(minLength: AppTheme.contentPadding)
			SidebarFooter(status: status)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 12)
		.frame(width: AppTheme.sidebarWidth)
		.background(AppTheme.sidebarBackground)
		.overlay(alignment: .trailing) {
			Rectangle()
				.fill(AppTheme.separator)
				.frame(width: 1)
		}
	}
}

private struct SidebarHeader: View {
	let status: AppStatus?

	var body: some View {
		HStack(spacing: 8) {
			Circle()
				.fill(AppTheme.accent)
				.frame(width: 10, height: 10)
			Text("Toby")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			if let version = status?.version {
				Text("v\(version)")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.padding(.horizontal, 8)
		.padding(.bottom, 14)
	}
}

private struct SidebarPrimaryActions: View {
	let onNewChat: () -> Void
	let onSearch: () -> Void
	let isLoading: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button(action: onNewChat) {
				Label("New chat", systemImage: "square.and.pencil")
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(SidebarButtonStyle())
			.disabled(isLoading)
			Button(action: onSearch) {
				Label("Search", systemImage: "magnifyingglass")
					.frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
			}
			.buttonStyle(SidebarButtonStyle())
		}
		.padding(.bottom, 14)
	}
}

private struct SidebarSection<Content: View>: View {
	let title: String
	@ViewBuilder let content: Content

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text(title)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
			content
		}
	}
}

private struct SidebarRow: View {
	let title: String
	let systemImage: String
	var isSelected = false

	var body: some View {
		Label(title, systemImage: systemImage)
			.font(.callout)
			.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
			.lineLimit(1)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(isSelected ? AppTheme.selection : Color.clear)
			)
	}
}

private struct SidebarFooter: View {
	let status: AppStatus?

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text(status?.persona ?? "Connecting")
				.font(.callout)
				.foregroundStyle(AppTheme.primaryText)
			Text(status?.model ?? "Waiting for daemon")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(1)
		}
		.padding(8)
	}
}

private struct SidebarButtonStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.callout)
			.foregroundStyle(AppTheme.primaryText)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(configuration.isPressed ? AppTheme.selection : Color.clear)
			)
	}
}
