import SwiftUI

struct AppSidebar: View {
	let sessionName: String
	let status: AppStatus?
	let isLoading: Bool
	let onNewChat: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarHeader(status: status)
			SidebarPrimaryActions(onNewChat: onNewChat, isLoading: isLoading)
			SidebarSection(title: "Workspace") {
				SidebarRow(title: sessionName, systemImage: "message", isSelected: true)
				SidebarRow(title: "Server event log", systemImage: "doc.text.magnifyingglass")
			}
			SidebarSection(title: "Toby") {
				SidebarRow(title: "Plugins", systemImage: "square.grid.2x2")
				SidebarRow(title: "Schedules", systemImage: "clock")
				SidebarRow(title: "Settings", systemImage: "gearshape")
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
	let isLoading: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button(action: onNewChat) {
				Label("New chat", systemImage: "square.and.pencil")
					.frame(maxWidth: .infinity, alignment: .leading)
			}
			.buttonStyle(SidebarButtonStyle())
			.disabled(isLoading)
			SidebarRow(title: "Search", systemImage: "magnifyingglass")
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
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(configuration.isPressed ? AppTheme.selection : Color.clear)
			)
	}
}
