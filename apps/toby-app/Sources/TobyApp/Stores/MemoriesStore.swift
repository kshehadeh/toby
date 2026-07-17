import Foundation
import Observation

@Observable
@MainActor
final class MemoriesStore {
	var memories: [MemoryItem] = []
	var selectedMemoryId: String?
	var selectedMemory: MemoryItem?
	var isListLoading = false
	var isDetailLoading = false
	var isSaving = false
	var hasLoadedOnce = false
	var lastLoadedAt: Date?
	var errorMessage: String?
	var pendingDelete: PendingDelete?
	var searchQuery: String = ""
	var total: Int = 0
	var hasMore: Bool = false
	var isCreatingNew: Bool = false

	struct PendingDelete: Identifiable {
		let id: String
		let value: String
	}

	/// Tools that create, update, or delete durable memory.
	static let mutatingMemoryTools: Set<String> = [
		"memoryPropose",
		"memorySave",
		"memoryForget",
	]

	private let client = TobyClient()
	private let pageSize: Int = 50
	private var pollTask: Task<Void, Never>?
	private var isQuietRefreshing = false
	/// When true, the next `ensureLoaded` / appear path should re-fetch.
	private(set) var isDirty = false

	/// Interval for quiet polling while the memories UI is visible.
	static let pollIntervalNanoseconds: UInt64 = 5_000_000_000

	func load() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			try await loadListData()
			if isCreatingNew {
				// Keep create mode; don't force a selection.
			} else if let selectedMemoryId {
				await loadDetail(id: selectedMemoryId)
			} else {
				selectedMemory = nil
			}
			isDirty = false
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func loadList() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			try await loadListData()
			isDirty = false
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	/// Soft re-fetch without loading spinners (polling / external invalidation).
	func refreshQuietly() async {
		guard !isListLoading, !isQuietRefreshing, !isSaving else { return }
		isQuietRefreshing = true
		defer { isQuietRefreshing = false }
		do {
			try await loadListData(autoSelectIfNeeded: !isCreatingNew)
			// Only refresh the open detail when it is still selected and not in create mode.
			// Avoid clobbering an in-progress editor draft unless the item vanished.
			if !isCreatingNew, let id = selectedMemoryId {
				if let listed = memories.first(where: { $0.id == id }) {
					// Prefer list payload for selected row freshness without a detail spinner.
					if selectedMemory?.updatedAt != listed.updatedAt
						|| selectedMemory?.value != listed.value
						|| selectedMemory?.type != listed.type
						|| selectedMemory?.subject != listed.subject
						|| selectedMemory?.sensitivity != listed.sensitivity
						|| selectedMemory?.visibility != listed.visibility
						|| selectedMemory?.confidence != listed.confidence
					{
						selectedMemory = listed
					}
				} else {
					selectedMemory = nil
					if let next = selectedMemoryId {
						await loadDetailQuietly(id: next)
					}
				}
			}
			isDirty = false
		} catch {
			// Quiet refresh failures are non-fatal; next poll or explicit load retries.
		}
	}

	func ensureLoaded() async {
		if hasLoadedOnce, !isDirty {
			if let selectedMemoryId, selectedMemory == nil, !isCreatingNew {
				await loadDetail(id: selectedMemoryId)
			}
			return
		}
		await load()
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce || isDirty else { return }
		await loadList()
	}

	/// Mark the store stale so the next load / ensure path re-fetches.
	/// Posted from chat when memory tools mutate data.
	func markDirty() {
		isDirty = true
	}

	/// Handle an external memory change (chat tools, etc.).
	/// Refreshes immediately when the memories UI is open (polling active);
	/// otherwise marks dirty for the next appear/ensure.
	func handleExternalMemoryChange() {
		markDirty()
		if pollTask != nil {
			Task { await refreshQuietly() }
		}
	}

	func search(_ query: String) async {
		searchQuery = query
		await load()
	}

	func startCreate() {
		isCreatingNew = true
		selectedMemoryId = nil
		selectedMemory = nil
	}

	func cancelCreate() {
		isCreatingNew = false
	}

	func selectMemory(id: String) async {
		isCreatingNew = false
		selectedMemoryId = id
		await loadDetail(id: id)
	}

	@discardableResult
	func createMemory(
		type: String,
		subject: String?,
		value: String,
		confidence: Double?,
		sensitivity: String?,
		visibility: String?
	) async -> Bool {
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		let request = MemoryCreateRequest(
			type: type,
			subject: subject,
			value: value,
			confidence: confidence,
			sensitivity: sensitivity,
			visibility: visibility
		)
		do {
			let created = try await client.createMemory(request)
			isCreatingNew = false
			await load()
			selectedMemoryId = created.id
			await loadDetail(id: created.id)
			return true
		} catch {
			errorMessage = error.localizedDescription
			return false
		}
	}

	func updateMemory(
		id: String,
		type: String?,
		subject: String?,
		value: String?,
		confidence: Double?,
		sensitivity: String?,
		visibility: String?
	) async {
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		let patch = MemoryPatchRequest(
			type: type,
			subject: subject,
			value: value,
			confidence: confidence,
			sensitivity: sensitivity,
			visibility: visibility
		)
		do {
			let updated = try await client.patchMemory(id: id, patch: patch)
			if let idx = memories.firstIndex(where: { $0.id == id }) {
				memories[idx] = updated
			}
			if selectedMemoryId == id {
				selectedMemory = updated
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteMemory(id: String) async {
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			try await client.deleteMemory(id: id)
			if selectedMemoryId == id {
				selectedMemoryId = nil
				selectedMemory = nil
			}
			await load()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func startPolling() {
		guard pollTask == nil else { return }
		pollTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: Self.pollIntervalNanoseconds)
				guard !Task.isCancelled, let self else { return }
				await self.refreshQuietly()
			}
		}
	}

	func stopPolling() {
		pollTask?.cancel()
		pollTask = nil
	}

	private func loadDetail(id: String) async {
		isDetailLoading = true
		errorMessage = nil
		defer { isDetailLoading = false }
		do {
			selectedMemory = try await client.fetchMemory(id: id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func loadDetailQuietly(id: String) async {
		do {
			selectedMemory = try await client.fetchMemory(id: id)
		} catch {
			// Soft-fail detail poll.
		}
	}

	private func loadListData(autoSelectIfNeeded: Bool = true) async throws {
		let response = try await client.listMemories(limit: pageSize, offset: 0, query: trimmedQuery)
		memories = response.memories
		total = response.total ?? memories.count
		hasMore = response.hasMore ?? false
		if autoSelectIfNeeded {
			if isCreatingNew {
				// Leave selection cleared for the create editor.
			} else if selectedMemoryId == nil || !memories.contains(where: { $0.id == selectedMemoryId }) {
				selectedMemoryId = memories.first?.id
			}
		} else if let selectedMemoryId, !memories.contains(where: { $0.id == selectedMemoryId }) {
			// Item deleted elsewhere while we intentionally kept create/selection rules soft.
			self.selectedMemoryId = memories.first?.id
		}
		hasLoadedOnce = true
		lastLoadedAt = Date()
	}

	private var trimmedQuery: String? {
		let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}
}
