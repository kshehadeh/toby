import SwiftUI

enum FlowSidebarFilter: String, CaseIterable {
	case all = "All"
	case manual = "Manual"
	case homeActions = "Home Actions"
	case homeRefresh = "Home Refresh"
	case scheduled = "Scheduled"
	case events = "Events"

	func matches(_ flow: FlowListItem) -> Bool {
		self == .all || (flow.triggers ?? []).contains { trigger in
			switch self {
			case .all: true
			case .manual: trigger.source.type == "manual"
			case .homeActions: trigger.source.type == "home.action"
			case .homeRefresh: trigger.source.type == "dashboard.refresh"
			case .scheduled: trigger.source.type == "schedule"
			case .events: trigger.source.type.hasPrefix("macos.")
			}
		}
	}
}

struct FlowsSidebarView: View {
	@Bindable var store: FlowsStore
	@Binding var showScriptTools: Bool
	@State private var filter = FlowSidebarFilter.all
	private var filteredFlows: [FlowListItem] { store.flows.filter { filter.matches($0) } }

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
		Picker("Filter flows", selection: $filter) {
            ForEach(FlowSidebarFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }.padding(.horizontal, 12).padding(.bottom, 10)
		Divider()
		FeatureBrowserList(
			isLoading: store.isListLoading,
			isEmpty: filteredFlows.isEmpty,
			loadingText: "Loading flows…",
			emptyText: "No flows",
			onClearSelection: { store.selectHome() }
		) {
			ForEach(filteredFlows) { flow in
				Button {
					if flow.builtin { TutorialStore.shared.advance(.builtInFlow) }
					Task { await store.selectFlow(id: flow.id) }
				} label: {
					FlowSidebarRow(
						flow: flow,
						isSelected: store.selectedFlowId == flow.id
					)
				}
				.tutorialTip(.builtInFlow, available: flow.id == filteredFlows.first(where: \.builtin)?.id, arrowEdge: .trailing) {
					Task { await store.selectFlow(id: flow.id) }
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
		.onChange(of: TutorialStore.shared.currentStep) { _, step in
			if step == .builtInFlow { filter = .all }
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
