import Foundation
import Observation

/// Home Actions tiles (runner-variant custom flows), in server order.
@Observable
@MainActor
final class DashboardBlockRegistry {
	private(set) var blocks: [CategoryDashboardBlock]

	init(blocks: [CategoryDashboardBlock] = []) {
		self.blocks = blocks.sorted { $0.sortIndex < $1.sortIndex }
	}

	func block(id: DashboardBlockID) -> CategoryDashboardBlock? {
		blocks.first { $0.id == id }
	}

	func block(rawId: String) -> CategoryDashboardBlock? {
		block(id: DashboardBlockID(rawId))
	}

	/// Replace tiles from the daemon list, keeping existing instances by id.
	func syncFlowBlocks(_ infos: [FlowDashboardBlockInfo]) {
		let existing = Dictionary(uniqueKeysWithValues: blocks.map { ($0.id.rawValue, $0) })
		var next: [CategoryDashboardBlock] = []
		for (offset, info) in infos.enumerated() where info.isRunner {
			let descriptor = DashboardBlockDescriptor.flow(info, sortIndex: offset)
			if let block = existing[info.id] {
				block.applyFlowDescriptor(descriptor)
				next.append(block)
			} else {
				next.append(CategoryDashboardBlock(descriptor: descriptor))
			}
		}
		blocks = next
	}

	var descriptors: [DashboardBlockDescriptor] {
		blocks.map(\.descriptor)
	}

	/// Tiles shown in the Actions rail (not hidden).
	func orderedVisibleRunners(layout: DashboardLayout) -> [CategoryDashboardBlock] {
		blocks.filter { !layout.isHidden(id: $0.id) }
	}

	/// Hidden tiles, in server order.
	func orderedHidden(layout: DashboardLayout) -> [CategoryDashboardBlock] {
		blocks.filter { layout.isHidden(id: $0.id) }
	}
}
