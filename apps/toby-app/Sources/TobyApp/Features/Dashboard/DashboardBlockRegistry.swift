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

	/// Replace only custom-flow cards. Built-ins keep their in-flight state.
	func syncFlowBlocks(_ infos: [FlowDashboardBlockInfo], client: TobyClient) {
		let builtIns = blocks.filter { !$0.descriptor.isFlowBlock }
		let existing = Dictionary(
			uniqueKeysWithValues: blocks.filter(\.descriptor.isFlowBlock).map { ($0.id.rawValue, $0) }
		)
		var next = builtIns
		for (offset, info) in infos.enumerated() {
			let sortIndex = 100 + offset
			let descriptor = DashboardBlockDescriptor.flow(info, sortIndex: sortIndex)
			if let block = existing[info.id] {
				block.applyFlowDescriptor(descriptor)
				next.append(block)
			} else {
				next.append(CategoryDashboardBlock(descriptor: descriptor, client: client))
			}
		}
		blocks = next.sorted { $0.sortIndex < $1.sortIndex }
	}

	/// Blocks sorted for layout, filtered by appearance visibility.
	func orderedVisible(preferences: AppearancePreferences) -> [CategoryDashboardBlock] {
		blocks
			.filter { preferences.isDashboardBlockVisible(id: $0.id) }
			.sorted { $0.sortIndex < $1.sortIndex }
	}
}
