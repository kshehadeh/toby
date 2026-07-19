import SwiftUI

struct FlowsSidebarView: View {
	@Bindable var store: FlowsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button {
				store.selectHome()
			} label: {
				HStack(spacing: 8) {
					Image(systemName: "square.grid.2x2")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(store.selectedFlowId == nil ? AppTheme.accent : AppTheme.tertiaryText)
						.frame(width: 16)
					Text("All Flows")
						.font(.caption.weight(.medium))
						.foregroundStyle(store.selectedFlowId == nil ? AppTheme.primaryText : AppTheme.secondaryText)
					Spacer(minLength: 0)
				}
				.padding(.horizontal, 10)
				.padding(.vertical, 8)
				.contentShape(Rectangle())
				.background(
					RoundedRectangle(cornerRadius: 8)
						.fill(store.selectedFlowId == nil ? Color.white.opacity(0.10) : Color.clear)
				)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("flows-home-button")
			.padding(.horizontal, 10)
			.padding(.top, 10)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isListLoading && store.flows.isEmpty {
						Text("Loading flows…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.flows.isEmpty {
						Text("No flows")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
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
									// Custom flow delete is future work; keep menu reserved.
									Text("Delete is not available yet")
								}
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)

			if !store.isListLoading || !store.flows.isEmpty {
				HStack(spacing: 4) {
					Text("\(store.flows.count) flow\(store.flows.count == 1 ? "" : "s")")
						.foregroundStyle(AppTheme.tertiaryText)
					if store.builtinCount > 0 {
						Text("·")
							.foregroundStyle(AppTheme.tertiaryText)
						Text("\(store.builtinCount) built-in")
							.foregroundStyle(AppTheme.secondaryText)
					}
				}
				.font(.caption)
				.padding(.horizontal, 14)
				.padding(.vertical, 10)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(AppTheme.sidebarBackground)
				.overlay(alignment: .top) {
					Rectangle()
						.fill(AppTheme.separator)
						.frame(height: 1)
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
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
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
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}
