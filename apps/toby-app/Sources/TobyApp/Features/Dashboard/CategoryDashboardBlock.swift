import Foundation
import Observation

/// Runtime model for one Home Actions tile. Tiles never auto-run; the row
/// view owns run state.
@Observable
@MainActor
final class CategoryDashboardBlock: Identifiable {
	/// Stable identity (the flow id). Immutable after init.
	nonisolated let id: DashboardBlockID
	private(set) var descriptor: DashboardBlockDescriptor

	var title: String { descriptor.title }
	var systemImage: String { descriptor.systemImage }
	var sortIndex: Int { descriptor.sortIndex }
	var accessibilityIdentifier: String { descriptor.accessibilityIdentifier }

	init(descriptor: DashboardBlockDescriptor) {
		self.id = descriptor.id
		self.descriptor = descriptor
	}

	func applyFlowDescriptor(_ next: DashboardBlockDescriptor) {
		descriptor = next
	}
}
