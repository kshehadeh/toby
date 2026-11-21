import Foundation
import Observation

/// Home: The Feed plus the Actions rail tiles.
@Observable
@MainActor
final class DashboardStore {
	let registry: DashboardBlockRegistry
	/// The Feed (the only Home content section).
	let feed: FeedStore
	/// The user's guidance for what The Feed includes and how it ranks.
	let feedInstructions: FeedInstructionsStore

	var hasLoadedOnce = false

	/// True for the full duration of a global force refresh (toolbar spinner).
	private(set) var isGlobalUpdating = false

	private let client: TobyClient

	init(client: TobyClient = TobyClient()) {
		self.client = client
		self.registry = DashboardBlockRegistry()
		self.feed = FeedStore(client: client)
		self.feedInstructions = FeedInstructionsStore(client: client)
	}

	/// Actions rail tiles.
	var blocks: [CategoryDashboardBlock] { registry.blocks }

	/// Toolbar disable / global spinner — entire force refresh.
	var isRefreshing: Bool { isGlobalUpdating }

	func syncFlowBlocks() async {
		do {
			let infos = try await client.fetchFlowDashboardBlocks()
			registry.syncFlowBlocks(infos)
		} catch {
			// Keep current tiles if the list fails.
		}
	}

	/// Soft or force refresh: Actions tiles + The Feed.
	func updateAll(force: Bool) async {
		if force {
			isGlobalUpdating = true
		}
		defer {
			if force {
				isGlobalUpdating = false
			}
		}
		async let tiles: () = syncFlowBlocks()
		async let feedUpdate: () = feed.update(force: force)
		_ = await (tiles, feedUpdate)
		hasLoadedOnce = true
	}

	/// Clears Home state after a Toby home directory switch.
	func resetForHomeSwitch() {
		hasLoadedOnce = false
		isGlobalUpdating = false
		registry.syncFlowBlocks([])
		feed.reset()
	}

	/// Global toolbar refresh — force The Feed and hold the spinner until done.
	func refreshAll() async {
		await updateAll(force: true)
	}
}
