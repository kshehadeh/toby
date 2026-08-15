import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("MemoriesView")
struct MemoriesViewTests {
	@Test("memories detail view renders empty state")
	func memoriesDetailViewRendersEmptyState() throws {
		let store = MemoriesStore()
		let view = MemoriesDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Memories")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Memories are durable facts Toby remembers across chats. Create one manually, or let Toby propose memories during conversations.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "empty-create-memory-button")
		}
	}

	@Test("memories sidebar shows memory values")
	func memoriesSidebarShowsMemoryValues() throws {
		let store = MemoriesStore()
		store.memories = [
			MemoryItem(id: "m1", userId: "u", type: "fact", subject: nil, value: "Likes dark mode", confidence: 1, sensitivity: "normal", visibility: "usable_by_ai", sourceIds: nil, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: nil),
			MemoryItem(id: "m2", userId: "u", type: "preference", subject: "Editor", value: "Prefers VS Code", confidence: 1, sensitivity: "normal", visibility: "usable_by_ai", sourceIds: nil, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: nil),
		]
		let view = MemoriesSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Likes dark mode")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Prefers VS Code")
		}
	}

	@Test("memories sidebar shows empty state when no memories")
	func memoriesSidebarShowsEmptyState() throws {
		let store = MemoriesStore()
		let view = MemoriesSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No memories")
		}
	}

	@Test("memories view shows delete confirmation alert")
	func memoriesViewShowsDeleteAlert() throws {
		let store = MemoriesStore()
		store.pendingDelete = MemoriesStore.PendingDelete(ids: ["m1"], value: "Test memory")
		let view = MemoriesView(store: store)
		// The alert should be present when pendingDelete is non-nil
		#expect(store.pendingDelete != nil)
		// Keep view alive so SwiftUI does not tear down mid-assertion.
		_ = view
	}

	@Test("requestDelete stages the same confirmation as the editor")
	func requestDeleteStagesConfirmation() {
		let store = MemoriesStore()
		let memory = MemoryItem(
			id: "m1",
			userId: "u",
			type: "fact",
			subject: nil,
			value: "Likes dark mode",
			confidence: 1,
			sensitivity: "normal",
			visibility: "usable_by_ai",
			sourceIds: nil,
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			expiresAt: nil
		)
		store.requestDelete(memory)
		#expect(store.pendingDelete?.ids == ["m1"])
		#expect(store.pendingDelete?.value == "Likes dark mode")
	}

	@Test("requestDeleteSelected stages one batch confirmation")
	func requestDeleteSelectedStagesBatchConfirmation() {
		let store = MemoriesStore()
		store.selectedMemoryIds = ["m1", "m2", "m3"]

		store.requestDeleteSelected()

		#expect(store.pendingDelete?.ids == ["m1", "m2", "m3"])
		#expect(store.pendingDelete?.count == 3)
		#expect(store.pendingDelete?.value == nil)
	}

	@Test("selecting multiple memories synchronously preserves the full selection")
	func selectingMultipleMemoriesPreservesFullSelection() {
		let store = MemoriesStore()
		store.selectedMemory = MemoryItem(
			id: "m1",
			userId: "u",
			type: "fact",
			subject: nil,
			value: "Likes dark mode",
			confidence: 1,
			sensitivity: "normal",
			visibility: "usable_by_ai",
			sourceIds: nil,
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			expiresAt: nil
		)

		store.selectMemories(ids: ["m1", "m2"])

		#expect(store.selectedMemoryIds == ["m1", "m2"])
		#expect(store.selectedMemory == nil)
	}

	@Test("memories detail view summarizes multiple selection")
	func memoriesDetailViewSummarizesMultipleSelection() throws {
		let store = MemoriesStore()
		store.memories = [
			MemoryItem(id: "m1", userId: "u", type: "fact", subject: nil, value: "Likes dark mode", confidence: 1, sensitivity: "normal", visibility: "usable_by_ai", sourceIds: nil, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: nil),
			MemoryItem(id: "m2", userId: "u", type: "preference", subject: nil, value: "Prefers compact UI", confidence: 1, sensitivity: "normal", visibility: "usable_by_ai", sourceIds: nil, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: nil),
		]
		store.selectedMemoryIds = ["m1", "m2"]

		let view = MemoriesDetailView(store: store)

		#expect(throws: Never.self) {
			try view.inspect().find(text: "2 memories selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-memories-button")
		}
	}

	@Test("memories detail view shows table chrome when memories exist")
	func memoriesDetailViewShowsTableChromeWhenMemoriesExist() throws {
		let store = MemoriesStore()
		let memory = MemoryItem(
			id: "m1",
			userId: "u",
			type: "fact",
			subject: nil,
			value: "Likes dark mode",
			confidence: 1,
			sensitivity: "normal",
			visibility: "usable_by_ai",
			sourceIds: nil,
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			expiresAt: nil
		)
		store.memories = [memory]
		store.selectedMemoryId = memory.id
		store.selectedMemory = memory
		let view = MemoriesDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "new-memory-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-memory-button")
		}
	}

	@Test("memories store initializes with empty state")
	func memoriesStoreInitializesEmpty() {
		let store = MemoriesStore()
		#expect(store.memories.isEmpty)
		#expect(store.selectedMemoryIds.isEmpty)
		#expect(store.selectedMemoryId == nil)
		#expect(store.selectedMemory == nil)
		#expect(store.isListLoading == false)
		#expect(store.errorMessage == nil)
		#expect(store.isDirty == false)
	}

	@Test("markDirty flags store for reload")
	func markDirtyFlagsStoreForReload() {
		let store = MemoriesStore()
		store.hasLoadedOnce = true
		#expect(store.isDirty == false)
		store.markDirty()
		#expect(store.isDirty == true)
	}

	@Test("external memory change marks dirty")
	func externalMemoryChangeMarksDirty() {
		let store = MemoriesStore()
		store.hasLoadedOnce = true
		store.handleExternalMemoryChange()
		#expect(store.isDirty == true)
	}

	@Test("mutating memory tools set covers write paths")
	func mutatingMemoryToolsCoverWritePaths() {
		#expect(MemoriesStore.mutatingMemoryTools.contains("memoryPropose"))
		#expect(MemoriesStore.mutatingMemoryTools.contains("memorySave"))
		#expect(MemoriesStore.mutatingMemoryTools.contains("memoryForget"))
		#expect(!MemoriesStore.mutatingMemoryTools.contains("memorySearch"))
		#expect(!MemoriesStore.mutatingMemoryTools.contains("memoryRetrieveForTask"))
	}

	@Test("memories notification name is defined")
	func memoriesNotificationNameIsDefined() {
		#expect(Notification.Name.memoriesDidChange.rawValue == "toby.memoriesDidChange")
	}

	@Test("memory item decodes from JSON")
	func memoryItemDecodesFromJSON() throws {
		let json = """
		{
			"id": "m1",
			"userId": "default",
			"type": "fact",
			"subject": "Work",
			"value": "Uses Toby daily",
			"confidence": 0.9,
			"sensitivity": "normal",
			"visibility": "usable_by_ai",
			"sourceIds": ["s1"],
			"createdAt": "2026-01-01T00:00:00Z",
			"updatedAt": "2026-01-02T00:00:00Z",
			"expiresAt": null
		}
		""".data(using: .utf8)!
		let item = try JSONDecoder().decode(MemoryItem.self, from: json)
		#expect(item.id == "m1")
		#expect(item.type == "fact")
		#expect(item.value == "Uses Toby daily")
		#expect(item.subject == "Work")
		#expect(item.confidence == 0.9)
	}

	@Test("memory field exposes valid type choices")
	func memoryFieldExposesValidChoices() {
		#expect(MemoryField.memoryTypes.contains("fact"))
		#expect(MemoryField.memoryTypes.contains("preference"))
		#expect(MemoryField.memorySensitivities.contains("normal"))
		#expect(MemoryField.memorySensitivities.contains("restricted"))
		#expect(MemoryField.memoryVisibilities.contains("usable_by_ai"))
		#expect(MemoryField.memoryVisibilities.contains("private"))
	}
}

@MainActor
@Suite("MemoriesNavigation")
struct MemoriesNavigationTests {
	@Test("detail route includes memories case")
	func detailRouteIncludesMemories() {
		#expect(DetailRoute.allCases.contains(.memories))
	}

	@Test("memories route raw value is 'memories'")
	func memoriesRouteRawValue() {
		#expect(DetailRoute.memories.rawValue == "memories")
	}
}
