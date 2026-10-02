import SwiftUI

extension Binding where Value == FlowEditorDraft {
	/// Resolve by identity on each access. SwiftUI may read a row after removal
	/// or sheet dismissal, when the collection's original index no longer exists.
	func node(_ snapshot: FlowEditorNode) -> Binding<FlowEditorNode> {
		Binding<FlowEditorNode>(
			get: { wrappedValue.nodes.first(where: { $0.id == snapshot.id }) ?? snapshot },
			set: { value in
				guard let index = wrappedValue.nodes.firstIndex(where: { $0.id == snapshot.id }) else { return }
				wrappedValue.nodes[index] = value
			}
		)
	}

	func destination(_ snapshot: FlowEditorDestination) -> Binding<FlowEditorDestination> {
		Binding<FlowEditorDestination>(
			get: { wrappedValue.destinations.first(where: { $0.id == snapshot.id }) ?? snapshot },
			set: { value in
				guard let index = wrappedValue.destinations.firstIndex(where: { $0.id == snapshot.id }) else { return }
				wrappedValue.destinations[index] = value
			}
		)
	}
}
