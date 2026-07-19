import Foundation
import Observation

/// Holds registered dashboard data-block controllers.
/// Layout order = `sortIndex` (later: user-configured order).
@Observable
@MainActor
final class DashboardBlockRegistry {
	private(set) var blocks: [CategoryDashboardBlock]

	init(blocks: [CategoryDashboardBlock]? = nil, client: TobyClient = TobyClient()) {
		if let blocks {
			self.blocks = blocks.sorted { $0.sortIndex < $1.sortIndex }
		} else {
			self.blocks = DashboardBlockDescriptor.builtIn.map {
				CategoryDashboardBlock(descriptor: $0, client: client)
			}
		}
	}

	func block(id: DashboardBlockID) -> CategoryDashboardBlock? {
		blocks.first { $0.id == id }
	}

	func block(rawId: String) -> CategoryDashboardBlock? {
		block(id: DashboardBlockID(rawId))
	}

	/// Blocks sorted for layout, filtered by appearance visibility.
	func orderedVisible(preferences: AppearancePreferences) -> [CategoryDashboardBlock] {
		blocks
			.filter { preferences.isDashboardBlockVisible(id: $0.id) }
			.sorted { $0.sortIndex < $1.sortIndex }
	}
}
