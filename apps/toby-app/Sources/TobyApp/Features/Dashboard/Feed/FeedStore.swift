import Foundation
import Observation

/// Outcome of a daemon-run Feed action, for a confirmation / error toast.
enum FeedActionOutcome: Equatable, Sendable {
	case success(String)
	case failure(String)
}

/// Loads The Feed (`GET /api/dashboard/feed`) and runs daemon-side actions
/// (`POST /api/dashboard/feed/actions`). Acted-on items hide optimistically and
/// come back if the action fails; the daemon persists dismiss / snooze / done.
@Observable
@MainActor
final class FeedStore {
	private(set) var content: FeedContent?
	private(set) var isLoading = false
	private(set) var error: String?
	/// Item ids hidden while (or after) an action runs.
	private(set) var hiddenIDs: Set<String> = []
	/// Item ids with an action in flight.
	private(set) var busyIDs: Set<String> = []

	@ObservationIgnored
	private let fetch: @MainActor (Bool) async throws -> FeedContent
	@ObservationIgnored
	private let performRemote: @MainActor (String, String) async throws -> FeedActionResponse
	@ObservationIgnored
	private var inFlight: Task<Void, Never>?
	@ObservationIgnored private var session = 0

	init(client: TobyClient = TobyClient()) {
		self.fetch = { fresh in try await client.fetchDashboardFeed(fresh: fresh) }
		self.performRemote = { itemID, actionID in
			try await client.performFeedAction(itemID: itemID, actionID: actionID)
		}
	}

	/// Test seam.
	init(
		fetch: @escaping @MainActor (Bool) async throws -> FeedContent,
		perform: @escaping @MainActor (String, String) async throws -> FeedActionResponse = { _, _ in
			FeedActionResponse(ok: true)
		}
	) {
		self.fetch = fetch
		self.performRemote = perform
	}

	var groupedItems: [(tier: FeedTier, items: [FeedItem])] {
		content?.groupedItems(excluding: hiddenIDs) ?? []
	}

	var hasVisibleItems: Bool { !groupedItems.isEmpty }

	/// Soft (server-cached) or forced refresh; concurrent soft calls coalesce.
	func update(force: Bool) async {
		if let inFlight, !force {
			await inFlight.value
			return
		}
		let session = self.session
		let task = Task { @MainActor in await self.performUpdate(force: force, session: session) }
		inFlight = task
		await task.value
		if inFlight == task { inFlight = nil }
	}

	private func performUpdate(force: Bool, session: Int) async {
		guard self.session == session else { return }
		isLoading = true
		defer { if self.session == session { isLoading = false } }
		do {
			let next = try await fetch(force)
			guard self.session == session else { return }
			apply(next)
			error = nil
		} catch {
			if self.session == session { self.error = error.localizedDescription }
		}
	}

	private func apply(_ next: FeedContent) {
		if let incoming = next.generation, let current = content?.generation, incoming < current { return }
		content = next
		// Keep hiding only in-flight items; the daemon filters the rest.
		hiddenIDs.formIntersection(busyIDs)
	}

	/// Runs a daemon-side action (tool or snooze/dismiss) on `item`.
	@discardableResult
	func perform(_ action: FeedAction, on item: FeedItem) async -> FeedActionOutcome {
		guard action.runsInDaemon, !busyIDs.contains(item.id) else {
			return .failure("\(action.label) isn't available.")
		}
		let session = self.session
		busyIDs.insert(item.id)
		hiddenIDs.insert(item.id)
		defer { if self.session == session { busyIDs.remove(item.id) } }
		do {
			let response = try await performRemote(item.id, action.id)
			if self.session == session, let next = response.content {
				apply(next)
			}
			return .success(response.message ?? "\(action.label) done.")
		} catch {
			guard self.session == session else { return .failure(error.localizedDescription) }
			hiddenIDs.remove(item.id)
			// The list may be stale (a background re-rank replaced it); reload so
			// the user sees the current Feed.
			await update(force: false)
			return .failure(error.localizedDescription)
		}
	}

	func dismiss(_ item: FeedItem) async {
		guard let action = item.actions.first(where: \.isDismiss) else { return }
		await perform(action, on: item)
	}

	func reset() {
		session += 1
		inFlight?.cancel()
		inFlight = nil
		content = nil
		error = nil
		isLoading = false
		hiddenIDs = []
		busyIDs = []
	}
}
