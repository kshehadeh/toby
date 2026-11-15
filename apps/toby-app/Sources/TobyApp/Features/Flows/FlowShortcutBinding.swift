import Foundation

/// A saved manual trigger, not the currently selected flow or editor draft.
struct FlowShortcutBinding: Equatable, Identifiable, Sendable {
	let flowId: String
	let triggerId: String
	let flowName: String
	let shortcut: GlobalKeyboardShortcut
	var id: String { "\(flowId)/\(triggerId)" }

	@MainActor
	static func bindings(in flows: [FlowListItem]) -> [Self] {
		flows.filter { !$0.builtin }.flatMap { flow in
			(flow.triggers ?? []).compactMap { trigger in
				guard trigger.enabled, trigger.source.type == "manual",
					let shortcut = trigger.source.shortcut, shortcut.hasRequiredModifiers else { return nil }
				return Self(flowId: flow.id, triggerId: trigger.id, flowName: flow.displayName, shortcut: shortcut)
			}
		}.sorted { $0.id < $1.id }
	}

	func conflictMessage(
		appShortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut],
		bindings: [Self]
	) -> String? {
		if let action = GlobalHotkeyAction.allCases.first(where: {
			appShortcuts[$0].map { shortcut.matches($0) } ?? false
		}) {
			return "This shortcut is used by \(action.displayName) in Settings → General. Choose another combination."
		}
		if let other = bindings.first(where: { $0.id != id && shortcut.matches($0.shortcut) }) {
			return "This shortcut is also assigned to \(other.flowName). Choose a unique combination; conflicting flow shortcuts won’t run."
		}
		return nil
	}
}

extension Notification.Name {
	static let runFlowShortcut = Notification.Name("toby.runFlowShortcut")
}
