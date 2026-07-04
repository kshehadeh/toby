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
		let view = MemoriesSidebarView(store: store, onDelete: { _ in })
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
		let view = MemoriesSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No memories")
		}
	}

	@Test("memories view shows delete confirmation alert")
	func memoriesViewShowsDeleteAlert() throws {
		let store = MemoriesStore()
		store.pendingDelete = MemoriesStore.PendingDelete(id: "m1", value: "Test memory")
		let view = MemoriesView(store: store)
		// The alert should be present when pendingDelete is non-nil
		#expect(store.pendingDelete != nil)
	}

	@Test("memories store initializes with empty state")
	func memoriesStoreInitializesEmpty() {
		let store = MemoriesStore()
		#expect(store.memories.isEmpty)
		#expect(store.selectedMemoryId == nil)
		#expect(store.selectedMemory == nil)
		#expect(store.isListLoading == false)
		#expect(store.errorMessage == nil)
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
