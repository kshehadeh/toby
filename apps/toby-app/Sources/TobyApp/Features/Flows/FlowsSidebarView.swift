import SwiftUI

struct FlowsSidebarView: View {
	@Bindable var store: FlowsStore

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isListLoading,
			isEmpty: store.flows.isEmpty,
			loadingText: "Loading flows…",
			emptyText: "No flows",
			onClearSelection: { store.selectHome() }
		) {
			ForEach(store.flows) { flow in
				Button {
					Task { await store.selectFlow(id: flow.id) }
				} label: {
					FlowSidebarRow(
						flow: flow,
						isSelected: store.selectedFlowId == flow.id
					)
				}
				.buttonStyle(.plain)
				.contextMenu {
					if flow.builtin {
						Text("Built-in flows can’t be deleted")
					} else {
						Button("Edit") {
							Task { await store.startEdit(id: flow.id) }
						}
						Button("Delete", role: .destructive) {
							store.confirmDelete(id: flow.id)
						}
					}
				}
			}
		}
	}
}

struct FlowSidebarRow: View {
	let flow: FlowListItem
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: flow.systemImage)
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.accent : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: 6) {
					Text(flow.displayName)
						.font(.callout.weight(.medium))
						.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
						.lineLimit(1)
					if flow.builtin {
						Text("Built-in")
							.font(.system(size: 9, weight: .semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(.horizontal, 5)
							.padding(.vertical, 1)
							.background(
								Capsule()
									.fill(Color.white.opacity(0.08))
							)
					}
				}
				Text(flow.subtitle)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel(accessibilityLabel)
		.accessibilityAddTraits(isSelected ? [.isSelected] : [])
		.accessibilityIdentifier("flow-sidebar-row-\(flow.id)")
	}

	private var accessibilityLabel: String {
		if flow.builtin {
			return "\(flow.displayName), built-in, \(flow.subtitle)"
		}
		return "\(flow.displayName), \(flow.subtitle)"
	}
}
