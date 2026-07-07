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

	private let client = TobyClient()
	private let pageSize: Int = 50

	func load() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			try await loadListData()
			if let selectedMemoryId {
				await loadDetail(id: selectedMemoryId)
			} else {
				selectedMemory = nil
			}
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
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func ensureLoaded() async {
		if hasLoadedOnce {
			if let selectedMemoryId, selectedMemory == nil {
				await loadDetail(id: selectedMemoryId)
			}
			return
		}
		await load()
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce else { return }
		await loadList()
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

	private func loadListData() async throws {
		let response = try await client.listMemories(limit: pageSize, offset: 0, query: trimmedQuery)
		memories = response.memories
		total = response.total ?? memories.count
		hasMore = response.hasMore ?? false
		if selectedMemoryId == nil || !memories.contains(where: { $0.id == selectedMemoryId }) {
			selectedMemoryId = memories.first?.id
		}
		hasLoadedOnce = true
		lastLoadedAt = Date()
	}

	private var trimmedQuery: String? {
		let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}
}
