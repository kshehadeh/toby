import SwiftUI

enum DashboardRecentWorkKind: Equatable {
	case chat(String)
	case project(String)
}

struct DashboardRecentWorkItem: Identifiable, Equatable {
	let id: String
	let kind: DashboardRecentWorkKind
	let title: String
	let subtitle: String
	let updatedAt: Date?

	var systemImage: String {
		switch kind {
		case .chat: "bubble.left"
		case .project: "folder"
		}
	}

	static func merged(
		sessions: [SessionSummary],
		projects: [ProjectSummary],
		limit: Int = 5
	) -> [DashboardRecentWorkItem] {
		let chats = sessions
			.filter { $0.projectId == nil }
			.map {
				DashboardRecentWorkItem(
					id: "chat:\($0.id)",
					kind: .chat($0.id),
					title: $0.name,
					subtitle: "Recent chat",
					updatedAt: DashboardDate.parse($0.updatedAt ?? $0.createdAt)
				)
			}
		let projectItems = projects.map {
			DashboardRecentWorkItem(
				id: "project:\($0.id)",
				kind: .project($0.id),
				title: $0.name,
				subtitle: "Project",
				updatedAt: DashboardDate.parse($0.updatedAt ?? $0.createdAt)
			)
		}
		return Array((chats + projectItems).sorted(by: recencyOrder).prefix(max(0, limit)))
	}

	private static func recencyOrder(
		_ lhs: DashboardRecentWorkItem,
		_ rhs: DashboardRecentWorkItem
	) -> Bool {
		switch (lhs.updatedAt, rhs.updatedAt) {
		case let (left?, right?) where left != right:
			return left > right
		case (.some, .none):
			return true
		case (.none, .some):
			return false
		default:
			return lhs.id < rhs.id
		}
	}
}

struct DashboardRecentWorkSection: View {
	let items: [DashboardRecentWorkItem]
	let isLoading: Bool
	let onSelect: (DashboardRecentWorkItem) -> Void

	var body: some View {
		DashboardCard {
			CardHeader(
				title: "Continue working",
				systemImage: "clock.arrow.circlepath"
			) {
				EmptyView()
			}
			if items.isEmpty, isLoading {
				ProgressView("Loading recent work…")
					.controlSize(.small)
					.foregroundStyle(AppTheme.secondaryText)
					.frame(minHeight: 48)
			} else if items.isEmpty {
				Text("Recent chats and projects will appear here.")
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.tertiaryText)
					.frame(minHeight: 48)
			} else {
				VStack(spacing: 0) {
					ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
						if index > 0 {
							Divider().overlay(AppTheme.separator)
						}
						Button {
							onSelect(item)
						} label: {
							row(item)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("dashboard-recent-\(item.id)")
					}
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("dashboard-recent-work")
	}

	private func row(_ item: DashboardRecentWorkItem) -> some View {
		HStack(spacing: 12) {
			Image(systemName: item.systemImage)
				.font(.system(size: 15, weight: .medium))
				.foregroundStyle(AppTheme.primaryText)
				.frame(width: 24)
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 2) {
				Text(item.title)
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(item.subtitle)
					.font(.system(size: 10))
					.foregroundStyle(AppTheme.tertiaryText)
			}
			Spacer(minLength: 0)
			Image(systemName: "chevron.right")
				.font(.system(size: 10, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityHidden(true)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 9)
		.contentShape(Rectangle())
	}
}
