import Foundation
import Observation
import UniformTypeIdentifiers

@Observable
@MainActor
final class LibraryStore {
	var items: [LibraryAsset] = []
	var selectedItemIds: Set<String> = []
	var selectedItem: LibraryAsset?
	var isListLoading = false
	var isSaving = false
	var hasLoadedOnce = false
	var errorMessage: String?
	var pendingDelete: PendingDelete?
	var searchQuery: String = ""
	var total: Int = 0
	var hasMore: Bool = false
	var isImporterPresented = false
	var importerError: String?

	struct PendingDelete: Identifiable {
		let ids: Set<String>
		let title: String?

		var id: String { ids.sorted().joined(separator: ",") }
		var count: Int { ids.count }
	}

	static let mutatingLibraryTools: Set<String> = [
		"add_to_library",
		"update_in_library",
		"remove_from_library",
	]

	static let acceptedContentTypes: [UTType] = {
		var types: [UTType] = [.plainText, .pdf, .png, .jpeg, .gif, .webP]
		if let markdown = UTType(filenameExtension: "md") {
			types.append(markdown)
		}
		return types
	}()

	private let client = TobyClient()
	private let pageSize: Int = 50
	private var pollTask: Task<Void, Never>?
	/// Item ids whose out-of-funds failure has already raised the banner.
	private var announcedFundsItemIds: Set<String> = []
	private var isQuietRefreshing = false
	private(set) var isDirty = false

	static let pollIntervalNanoseconds: UInt64 = 5_000_000_000

	var selectedItemId: String? {
		get {
			guard selectedItemIds.count == 1 else { return nil }
			return selectedItemIds.first
		}
		set {
			selectedItemIds = newValue.map { [$0] } ?? []
		}
	}

	var inspectedItem: LibraryAsset? {
		if let selectedItem { return selectedItem }
		guard let id = selectedItemId else { return nil }
		return items.first { $0.id == id }
	}

	var hasPendingItems: Bool {
		items.contains { $0.isPending }
	}

	func resetForHomeSwitch() {
		stopPolling()
		items = []
		selectedItemIds = []
		selectedItem = nil
		isListLoading = false
		isSaving = false
		hasLoadedOnce = false
		errorMessage = nil
		pendingDelete = nil
		searchQuery = ""
		total = 0
		hasMore = false
		isImporterPresented = false
		importerError = nil
		isDirty = false
		isQuietRefreshing = false
	}

	func load() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			try await loadListData()
			if let selectedItemId {
				selectedItem = items.first { $0.id == selectedItemId }
			} else {
				selectedItem = nil
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

	func ensureListLoaded() async {
		guard !hasLoadedOnce || isDirty else { return }
		await loadList()
	}

	func refreshQuietly() async {
		guard !isListLoading, !isQuietRefreshing, !isSaving else { return }
		isQuietRefreshing = true
		defer { isQuietRefreshing = false }
		do {
			try await loadListData()
			if let id = selectedItemId {
				selectedItem = items.first { $0.id == id }
			}
			isDirty = false
		} catch {
			// Quiet refresh failures are non-fatal.
		}
	}

	func markDirty() {
		isDirty = true
	}

	func handleExternalLibraryChange() {
		markDirty()
		if pollTask != nil {
			Task { await refreshQuietly() }
		}
	}

	func search(_ query: String) async {
		searchQuery = query
		await load()
	}

	func clearSelection() {
		selectedItemIds = []
		selectedItem = nil
	}

	func selectHome() {
		clearSelection()
	}

	func selectItem(id: String) {
		selectedItemIds = [id]
		selectedItem = items.first { $0.id == id }
	}

	func selectItems(ids: Set<String>) {
		selectedItemIds = ids
		if ids.count == 1, let id = ids.first {
			selectedItem = items.first { $0.id == id }
		} else {
			selectedItem = nil
		}
	}

	func requestDelete(_ item: LibraryAsset) {
		pendingDelete = PendingDelete(ids: [item.id], title: item.title)
	}

	func requestDeleteSelected() {
		guard !selectedItemIds.isEmpty else { return }
		let title = selectedItemIds.count == 1 ? inspectedItem?.title : nil
		pendingDelete = PendingDelete(ids: selectedItemIds, title: title)
	}

	func deleteItems(ids: Set<String>) async {
		guard !ids.isEmpty else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			for id in ids {
				try await client.deleteLibraryItem(id: id)
			}
			selectedItemIds.subtract(ids)
			if let selectedId = selectedItemId, ids.contains(selectedId) {
				selectedItem = nil
			}
			try await loadListData()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func importFiles(urls: [URL]) async {
		guard !urls.isEmpty else { return }
		isSaving = true
		importerError = nil
		defer { isSaving = false }
		var lastId: String?
		do {
			for url in urls {
				let didAccess = url.startAccessingSecurityScopedResource()
				defer {
					if didAccess {
						url.stopAccessingSecurityScopedResource()
					}
				}
				let data = try Data(contentsOf: url)
				let mediaType = Self.mediaType(for: url)
				let created = try await client.createLibraryItem(
					LibraryCreateRequest(
						filename: url.lastPathComponent,
						mediaType: mediaType,
						dataBase64: data.base64EncodedString()
					)
				)
				lastId = created.item.id
			}
			try await loadListData()
			if let lastId {
				selectItem(id: lastId)
			}
		} catch {
			importerError = error.localizedDescription
			errorMessage = error.localizedDescription
		}
	}

	func startPolling() {
		guard pollTask == nil else { return }
		pollTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: Self.pollIntervalNanoseconds)
				guard !Task.isCancelled else { return }
				await self?.refreshQuietly()
			}
		}
	}

	func stopPolling() {
		pollTask?.cancel()
		pollTask = nil
	}

	private func loadListData() async throws {
		let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
		let response = try await client.listLibraryItems(
			limit: pageSize,
			offset: 0,
			query: query.isEmpty ? nil : query
		)
		items = response.items
		total = response.total
		hasMore = response.hasMore
		hasLoadedOnce = true
		announceGatewayFunds(in: response.items)
	}

	/// Indexing runs after the upload response, so a funds failure shows up on a later refresh.
	private func announceGatewayFunds(in items: [LibraryAsset]) {
		for item in items {
			guard let error = item.error, let notice = GatewayFundsNotice(libraryError: error) else {
				continue
			}
			guard announcedFundsItemIds.insert(item.id).inserted else { continue }
			GatewayFundsNotice.post(notice)
		}
	}

	static func mediaType(for url: URL) -> String {
		if let type = UTType(filenameExtension: url.pathExtension),
		   let mimeType = type.preferredMIMEType
		{
			if mimeType == "text/x-markdown" { return "text/markdown" }
			if mimeType == "image/jpg" { return "image/jpeg" }
			return mimeType
		}
		switch url.pathExtension.lowercased() {
		case "md", "markdown": return "text/markdown"
		case "txt": return "text/plain"
		case "pdf": return "application/pdf"
		case "png": return "image/png"
		case "jpg", "jpeg": return "image/jpeg"
		case "webp": return "image/webp"
		case "gif": return "image/gif"
		default: return "application/octet-stream"
		}
	}
}
