import SwiftUI

struct FlowsSidebarView: View {
	@Bindable var store: FlowsStore
	@Binding var showScriptTools: Bool

	init(store: FlowsStore, showScriptTools: Binding<Bool> = .constant(false)) {
		self.store = store
		self._showScriptTools = showScriptTools
	}

	var body: some View {
		VStack(spacing: 0) {
		Button {
			showScriptTools = true
		} label: {
			Label("Script Tools", systemImage: "curlybraces")
		}
		.buttonStyle(.plain)
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("open-script-tools")
		Divider()
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
}

struct FlowSidebarRow: View {
	let flow: FlowListItem
	let isSelected: Bool

	var body: some View {
		FeatureBrowserRow(
			title: flow.displayName,
			subtitle: flow.subtitle,
			badge: flow.builtin ? "Built-in" : nil,
			isSelected: isSelected,
			accessibilityLabel: accessibilityLabel,
			accessibilityIdentifier: "flow-sidebar-row-\(flow.id)"
		) {
			FeatureBrowserRowGlyph(systemImage: flow.systemImage, isSelected: isSelected)
		}
	}

	private var accessibilityLabel: String {
		if flow.builtin {
			return "\(flow.displayName), built-in, \(flow.subtitle)"
		}
		return "\(flow.displayName), \(flow.subtitle)"
	}
}
