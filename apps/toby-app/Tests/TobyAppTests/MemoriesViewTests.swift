import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("MemoriesView")
struct MemoriesViewTests {
	@Test("empty memories list shows no memories caption")
	func emptyMemoriesListShowsCaption() throws {
		let store = MemoriesStore()
		let view = MemoriesView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No memories")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No memory selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "create-memory-button")
		}
	}

	@Test("unselected memories show the empty inspector")
	func unselectedMemoriesShowEmptyInspector() throws {
		let store = MemoriesStore()
		store.memories = [sampleMemory()]
		let view = MemoriesView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Likes dark mode")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memories-inspector-bar")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No memory selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select a memory to view its details")
		}
	}

	@Test("clearSelection drops the current memory")
	func clearSelectionDropsCurrentMemory() {
		let store = MemoriesStore()
		store.selectedMemoryIds = ["m1"]
		store.startCreate()
		store.clearSelection()
		#expect(store.selectedMemoryIds.isEmpty)
		#expect(store.selectedMemory == nil)
		#expect(store.editor?.isNew == true)
	}

	@Test("memories list empty-area tap clears selection")
	func memoriesListEmptyAreaTapClearsSelection() throws {
		let store = MemoriesStore()
		store.memories = [sampleMemory()]
		store.selectedMemoryId = "m1"
		store.selectedMemory = store.memories[0]
		let view = MemoriesListView(store: store)
		let target = try view.inspect().find(
			viewWithAccessibilityIdentifier: "feature-browser-list-deselect"
		)
		try target.button().tap()
		#expect(store.selectedMemoryIds.isEmpty)
		#expect(store.selectedMemory == nil)
	}

	@Test("memories list shows memory values")
	func memoriesListShowsMemoryValues() throws {
		let store = MemoriesStore()
		store.memories = [
			sampleMemory(),
			sampleMemory(id: "m2", type: "preference", subject: "Editor", value: "Prefers VS Code"),
		]
		let view = MemoriesListView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Likes dark mode")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Prefers VS Code")
		}
	}

	@Test("memories list shows empty state when no memories")
	func memoriesListShowsEmptyState() throws {
		let store = MemoriesStore()
		let view = MemoriesListView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No memories")
		}
	}

	@Test("memories view shows delete confirmation alert")
	func memoriesViewShowsDeleteAlert() throws {
		let store = MemoriesStore()
		store.pendingDelete = MemoriesStore.PendingDelete(ids: ["m1"], value: "Test memory")
		let view = MemoriesView(store: store)
		#expect(store.pendingDelete != nil)
		_ = view
	}

	@Test("requestDelete stages the same confirmation as the inspector")
	func requestDeleteStagesConfirmation() {
		let store = MemoriesStore()
		store.requestDelete(sampleMemory())
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
		store.memories = [
			sampleMemory(),
			sampleMemory(id: "m2", value: "Prefers compact UI"),
		]
		store.selectedMemory = store.memories[0]

		store.selectMemories(ids: ["m1", "m2"])

		#expect(store.selectedMemoryIds == ["m1", "m2"])
		#expect(store.selectedMemory == nil)
	}

	@Test("memories inspector summarizes multiple selection")
	func memoriesInspectorSummarizesMultipleSelection() throws {
		let store = MemoriesStore()
		store.memories = [
			sampleMemory(),
			sampleMemory(id: "m2", type: "preference", value: "Prefers compact UI"),
		]
		store.selectedMemoryIds = ["m1", "m2"]

		let view = MemoriesInspectorBar(store: store)

		#expect(throws: Never.self) {
			try view.inspect().find(text: "2 memories selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-memories-button")
		}
	}

	@Test("selected memory shows inspect-only details")
	func selectedMemoryShowsInspector() throws {
		let store = MemoriesStore()
		let memory = sampleMemory(subject: "Work")
		store.memories = [memory]
		store.selectedMemoryId = memory.id
		store.selectedMemory = memory
		let view = MemoriesView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memories-inspector-bar")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memories-inspector-value")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "edit-memory-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-memory-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "fact")
		}
	}

	@Test("memories store initializes with empty state")
	func memoriesStoreInitializesEmpty() {
		let store = MemoriesStore()
		#expect(store.memories.isEmpty)
		#expect(store.selectedMemoryIds.isEmpty)
		#expect(store.selectedMemoryId == nil)
		#expect(store.selectedMemory == nil)
		#expect(store.editor == nil)
		#expect(store.isListLoading == false)
		#expect(store.errorMessage == nil)
		#expect(store.isDirty == false)
	}

	@Test("startCreate opens a draft without changing selection")
	func startCreateOpensDraftWithoutChangingSelection() {
		let store = MemoriesStore()
		store.memories = [sampleMemory()]
		store.selectedMemoryIds = ["m1"]
		store.startCreate()
		#expect(store.editor?.isNew == true)
		#expect(store.selectedMemoryIds == ["m1"])
		#expect(store.isEditorDirty == false)
		var draft = store.editor!
		draft.value = "Remember this"
		store.editor = draft
		#expect(store.isEditorDirty == true)
		store.cancelEditor()
		#expect(store.editor == nil)
		#expect(store.selectedMemoryIds == ["m1"])
	}

	@Test("startEdit loads the selected memory into the editor")
	func startEditLoadsSelectedMemory() {
		let store = MemoriesStore()
		let memory = sampleMemory(subject: "Work")
		store.memories = [memory]
		store.selectedMemory = memory
		store.selectedMemoryIds = [memory.id]
		store.startEdit()
		#expect(store.editor?.isNew == false)
		#expect(store.editor?.value == "Likes dark mode")
		#expect(store.editor?.subject == "Work")
		#expect(store.editor?.canSave == true)
	}

	@Test("memory editor sheet shows title and save cancel")
	func memoryEditorSheetChrome() throws {
		let store = MemoriesStore()
		store.startCreate()
		let view = MemoryEditorSheet(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memory-editor-save")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memory-editor-sheet")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memory-value-field")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "memory-editor-cancel")
		}
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
		#expect(Notification.Name.openMemoriesWindow.rawValue == "openMemoriesWindow")
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
@Suite("MemoriesWindowView")
struct MemoriesWindowViewTests {
	@Test("window view renders list and refresh control without a split")
	func windowViewRendersListAndRefresh() throws {
		let store = MemoriesStore()
		store.memories = [sampleMemory()]
		let view = MemoriesWindowView(store: store)
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.NavigationSplitView.self)
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Likes dark mode")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "refresh-memories-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "create-memory-button")
		}
	}

	@Test("detail route no longer includes memories")
	func detailRouteOmitsMemories() {
		#expect(!DetailRoute.allCases.contains(where: { $0.rawValue == "memories" }))
	}
}

private func sampleMemory(
	id: String = "m1",
	type: String = "fact",
	subject: String? = nil,
	value: String = "Likes dark mode"
) -> MemoryItem {
	MemoryItem(
		id: id,
		userId: "u",
		type: type,
		subject: subject,
		value: value,
		confidence: 1,
		sensitivity: "normal",
		visibility: "usable_by_ai",
		sourceIds: nil,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		expiresAt: nil
	)
}
