import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Todos workspace")
struct TodosViewTests {
	private func todo() throws -> TobyTodo {
		try JSONDecoder().decode(TobyTodo.self, from: Data(#"""
		{"id":"todo","revision":"revision","title":"Write tests","description":"Keep history",
		 "priority":"high","listId":"inbox","projectId":"project","projectLabel":"Example",
		 "tags":[],"due":{"date":"2027-01-02","time":"09:30","timezone":"UTC"},
		 "recurrence":{"mode":"calendar","unit":"week","interval":2,"weekdays":[1,3]},
		 "deleted":false,"occurrenceId":"todo:0","sequence":0,"state":{"status":"open","at":null},
		 "checklist":[{"id":"item","text":"Review","order":0,"checked":false}],"reminders":[]}
		"""#.utf8))
	}

	@Test("Todos is a main destination with an independent tutorial")
	func route() {
		#expect(DetailRoute.sidebarPrimary.contains(.todos))
		#expect(DetailRoute.todos.menuTitle == "Todos")
		#expect(DetailRoute.todos.systemImage == "checklist")
		#expect(TutorialSection.forRoute(.todos) == .todos)
	}

	@Test("Loaded todos do not automatically select an item")
	func noAutomaticSelection() throws {
		let store = TodosStore()
		store.todos = [try todo()]
		#expect(store.selectedTodo == nil)
		let detail = TodoDetailView(store: store, todo: try todo())
		#expect(try detail.inspect().find(text: "Write tests").string() == "Write tests")
	}

	@Test("Editor drafts preserve dates, repeats, and explicit clearing")
	func draftRoundTrip() throws {
		var draft = TodoEditorDraft(todo: try todo())
		#expect(draft.canSave)
		#expect(draft.projectId == "project")
		#expect(draft.weekdays == [1, 3])
		let due = try #require(draft.fields()["due"] as? [String: Any])
		#expect(due["date"] as? String == "2027-01-02")
		#expect(due["time"] as? String == "09:30")
		draft.hasDueDate = false
		draft.repeats = false
		draft.projectId = ""
		#expect(draft.fields()["due"] is NSNull)
		#expect(draft.fields()["recurrence"] is NSNull)
		#expect(draft.fields()["projectId"] is NSNull)
		draft.title = "  "
		#expect(!draft.canSave)
	}

	@Test("Refreshing model data does not replace a dirty editor")
	func dirtyDraft() throws {
		let store = TodosStore()
		store.startEditor(try todo())
		store.editor?.title = "Unsaved work"
		store.todos = [try todo()]
		#expect(store.isDirty)
		#expect(store.editor?.title == "Unsaved work")
		store.cancelEditor()
		#expect(!store.isDirty)
	}

	@Test("Home changes clear todos, drafts, selection, and filters")
	func homeReset() throws {
		let store = TodosStore()
		store.todos = [try todo()]
		store.selectedOccurrenceId = "todo:0"
		store.filter = .completed
		store.query = "old"
		store.projectId = "project"
		store.startEditor(try todo())
		store.resetForHomeSwitch()
		#expect(store.todos.isEmpty)
		#expect(store.selectedTodo == nil)
		#expect(store.editor == nil)
		#expect(store.query.isEmpty && store.projectId.isEmpty)
		#expect(store.filter == .inbox)
	}

	@Test("Checklist completion asks for explicit acknowledgement")
	func unfinishedChecklist() async throws {
		let store = TodosStore()
		let item = try todo()
		await store.complete(item)
		#expect(store.pendingComplete == item)
	}
}
