import Foundation
import Observation

/// Loads The Feed (`GET /api/dashboard/feed`) and tracks items dismissed in
/// this session. Dismissals are client-only until the daemon persists them.
@Observable
@MainActor
final class FeedStore {
	private(set) var content: FeedContent?
	private(set) var isLoading = false
	private(set) var error: String?
	/// Item ids hidden this session.
	private(set) var dismissedIDs: Set<String> = []

	@ObservationIgnored
	private let fetch: @MainActor (Bool) async throws -> FeedContent
	@ObservationIgnored
	private var inFlight: Task<Void, Never>?

	init(client: TobyClient = TobyClient()) {
		self.fetch = { fresh in try await client.fetchDashboardFeed(fresh: fresh) }
	}

	/// Test seam.
	init(fetch: @escaping @MainActor (Bool) async throws -> FeedContent) {
		self.fetch = fetch
	}

	var groupedItems: [(tier: FeedTier, items: [FeedItem])] {
		content?.groupedItems(excluding: dismissedIDs) ?? []
	}

	var hasVisibleItems: Bool { !groupedItems.isEmpty }

	/// Soft (server-cached) or forced refresh; concurrent soft calls coalesce.
	func update(force: Bool) async {
		if let inFlight, !force {
			await inFlight.value
			return
		}
		let task = Task { @MainActor in await self.performUpdate(force: force) }
		inFlight = task
		await task.value
		if inFlight == task { inFlight = nil }
	}

	private func performUpdate(force: Bool) async {
		isLoading = true
		defer { isLoading = false }
		do {
			let next = try await fetch(force)
			content = next
			error = nil
			// Forget dismissals for items that are no longer in the feed.
			dismissedIDs.formIntersection(next.items.map(\.id))
		} catch {
			self.error = error.localizedDescription
		}
	}

	func dismiss(_ item: FeedItem) {
		dismissedIDs.insert(item.id)
	}

	func reset() {
		inFlight?.cancel()
		inFlight = nil
		content = nil
		error = nil
		isLoading = false
		dismissedIDs = []
	}
}
