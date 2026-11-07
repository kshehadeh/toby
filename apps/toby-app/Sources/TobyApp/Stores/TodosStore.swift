import Foundation
import CryptoKit
import Observation

@Observable @MainActor
final class TodosStore {
	var todos: [TobyTodo] = []
	var total = 0
	var selectedOccurrenceId: String?
	private var linkedTodo: TobyTodo?
	var filter: TodoViewFilter = .inbox
	var query = ""
	var listId = ""
	var tagId = ""
	var projectId = ""
	var lists: [TodoOrganizationItem] = []
	var tags: [TodoOrganizationItem] = []
	var projects: [ProjectSummary] = []
	var editor: TodoEditorDraft?
	var originalEditor: TodoEditorDraft?
	var isLoading = false
	var isSaving = false
	var errorMessage: String?
	var editorError: String?
	var history: [TodoHistoryEntry] = []
	var isShowingOrganization = false
	var syncStatus: TodoSyncStatus?
	var pendingDelete: TobyTodo?
	var pendingComplete: TobyTodo?
	@ObservationIgnored private let client: TobyClient
	@ObservationIgnored private var generation = UUID()
	@ObservationIgnored private var requestId = UUID()

	init(client: TobyClient = TobyClient()) { self.client = client }
	var selectedTodo: TobyTodo? {
		todos.first { $0.occurrenceId == selectedOccurrenceId } ??
			(linkedTodo?.occurrenceId == selectedOccurrenceId ? linkedTodo : nil)
	}
	var isDirty: Bool { editor != originalEditor }
	var today: String { TodoEditorDraft.dateFormatter(timezone: TimeZone.current.identifier).string(from: Date()) }

	func openTodo(_ reference: String) async {
		let home = generation
		let parts = reference.split(separator: ":")
		guard let first = parts.first else { return }
		let id = String(first)
		let sequence = parts.count == 2 ? Int(parts[1]) : nil
		do {
			let todo = try await client.fetchTodo(id, sequence: sequence)
			guard home == generation else { return }
			linkedTodo = todo
			selectedOccurrenceId = todo.occurrenceId
		} catch { if home == generation { errorMessage = error.localizedDescription } }
	}

	func refresh(append: Bool = false) async {
		let home = generation
		let request = UUID()
		requestId = request
		isLoading = true
		defer { if requestId == request { isLoading = false } }
		var parameters = ["limit": "200", "offset": append ? String(todos.count) : "0", "status": "open", "query": query]
		switch filter {
		case .inbox: parameters["listId"] = "inbox"
		case .today: parameters["dueTo"] = today
		case .upcoming: parameters["dueFrom"] = today
		case .allOpen: break
		case .completed: parameters["status"] = "completed"
		case .deleted: parameters["status"] = "deleted"
		}
		if !listId.isEmpty { parameters["listId"] = listId }
		if !tagId.isEmpty { parameters["tagId"] = tagId }
		if !projectId.isEmpty { parameters["projectId"] = projectId }
		do {
			let page = try await client.listTodos(query: parameters)
			guard generation == home, requestId == request else { return }
			todos = append ? todos + page.todos : page.todos
			total = page.total
			if let linkedTodo, linkedTodo.occurrenceId == selectedOccurrenceId {
				let updated = try await client.fetchTodo(linkedTodo.id, sequence: linkedTodo.sequence)
				guard generation == home, requestId == request else { return }
				self.linkedTodo = updated
			}
			errorMessage = nil
			let status: TodoSyncStatus? = try? await client.todoRequest("/sync")
			if generation == home, requestId == request { syncStatus = status }
		} catch {
			guard generation == home, requestId == request else { return }
			errorMessage = error.localizedDescription
		}
	}

	func loadOrganization() async {
		let home = generation
		do {
			async let fetchedLists = client.todoOrganization("lists")
			async let fetchedTags = client.todoOrganization("tags")
			async let fetchedProjects = client.listProjects()
			let result = try await (fetchedLists, fetchedTags, fetchedProjects)
			guard generation == home else { return }
			(lists, tags, projects) = result
		} catch { if generation == home { errorMessage = error.localizedDescription } }
	}

	func startEditor(_ todo: TobyTodo? = nil, projectId: String = "", projectLabel: String? = nil) {
		editorError = nil
		let draft = TodoEditorDraft(todo: todo, projectId: projectId, projectLabel: projectLabel)
		editor = draft
		originalEditor = draft
	}
	func cancelEditor() { editor = nil; originalEditor = nil; editorError = nil }
	func saveEditor() async {
		guard let draft = editor, draft.canSave, !isSaving else { return }
		isSaving = true
		let home = generation
		defer { if generation == home { isSaving = false } }
		do {
			let encoded = try JSONSerialization.data(withJSONObject: draft.fields(), options: .sortedKeys)
			let fingerprint = SHA256.hash(data: encoded).map { String(format: "%02x", $0) }.joined()
			var input: [String: Any] = ["idempotencyKey": "editor:\(draft.id):\(fingerprint)"]
			if let id = draft.todoId {
				input["id"] = id
				input["changes"] = draft.fields()
				input["expectedRevision"] = draft.revision
				try await client.mutateTodo("update", input: input)
			} else {
				input.merge(draft.fields()) { _, new in new }
				try await client.mutateTodo("create", input: input)
			}
			guard generation == home else { return }
			cancelEditor()
			await refresh()
		} catch { if generation == home { editorError = error.localizedDescription } }
	}
	func mutate(_ action: String, todo: TobyTodo, extra: [String: Any] = [:]) async {
		let home = generation
		var input: [String: Any] = ["id": todo.id, "sequence": todo.sequence, "expectedRevision": todo.revision]
		input.merge(extra) { _, new in new }
		if !["complete", "skip", "reopen"].contains(action) { input.removeValue(forKey: "sequence") }
		do {
			try await client.mutateTodo(action, input: input)
			guard generation == home else { return }
			await refresh()
		} catch { if generation == home { errorMessage = error.localizedDescription } }
	}
	func complete(_ todo: TobyTodo) async {
		if todo.checklist.contains(where: { !$0.checked }) { pendingComplete = todo }
		else { await mutate("complete", todo: todo) }
	}
	func addChecklistItem(_ text: String, to todo: TobyTodo) async {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		let order = (todo.checklist.map(\.order).max() ?? -1) + 1
		await mutate("setChecklistItem", todo: todo, extra: [
			"item": ["id": UUID().uuidString.lowercased(), "text": trimmed, "order": order, "checked": false],
		])
	}
	func setChecklistItem(_ item: TodoChecklistItem, checked: Bool, on todo: TobyTodo) async {
		await mutate("setChecklistItem", todo: todo, extra: [
			"item": ["id": item.id, "text": item.text, "order": item.order, "checked": checked],
		])
	}
	func removeChecklistItem(_ item: TodoChecklistItem, from todo: TobyTodo) async {
		await mutate("setChecklistItem", todo: todo, extra: [
			"item": ["id": item.id, "text": item.text, "order": item.order, "checked": item.checked], "remove": true,
		])
	}
	func setTag(_ tagId: String, enabled: Bool, on todo: TobyTodo) async {
		await mutate("setTag", todo: todo, extra: ["tagId": tagId, "enabled": enabled])
	}
	/// Pass an offset for due-relative reminders, or an absolute date. Date-only todos need an absolute date.
	func addReminder(to todo: TobyTodo, offsetMinutes: Int? = nil, at date: Date? = nil) async {
		let at: Any = date.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()
		await mutate("setReminder", todo: todo, extra: ["reminder": [
			"id": UUID().uuidString.lowercased(), "at": at,
			"offsetMinutes": offsetMinutes.map { $0 as Any } ?? NSNull(), "snoozedUntil": NSNull(),
		]])
	}
	func snoozeReminder(_ reminder: TodoReminder, on todo: TobyTodo, until date: Date) async {
		await mutate("setReminder", todo: todo, extra: ["reminder": reminderPayload(reminder, snoozedUntil: ISO8601DateFormatter().string(from: date))])
	}
	func removeReminder(_ reminder: TodoReminder, from todo: TobyTodo) async {
		await mutate("setReminder", todo: todo, extra: ["reminder": reminderPayload(reminder, snoozedUntil: nil), "remove": true])
	}
	private func reminderPayload(_ reminder: TodoReminder, snoozedUntil: String?) -> [String: Any] {
		[
			"id": reminder.id, "at": reminder.at.map { $0 as Any } ?? NSNull(),
			"offsetMinutes": reminder.offsetMinutes.map { $0 as Any } ?? NSNull(),
			"snoozedUntil": snoozedUntil.map { $0 as Any } ?? NSNull(),
		]
	}
	func restoreField(_ entry: TodoHistoryEntry, on todo: TobyTodo) async {
		await mutate("restoreField", todo: todo, extra: ["operationId": entry.operationId, "field": entry.field])
		if let current = selectedTodo, current.id == todo.id { await loadHistory(current) }
	}
	/// Lists and tags apply immediately; removal moves todos to Inbox or drops the tag without deleting todos.
	@discardableResult
	func saveOrganization(_ kind: TodoOrganizationKind, id: String? = nil, name: String? = nil, remove: Bool = false) async -> Bool {
		let home = generation
		var input: [String: Any] = ["remove": remove]
		if let id { input["id"] = id }
		if let name { input["name"] = name.trimmingCharacters(in: .whitespacesAndNewlines) }
		do {
			try await client.mutateTodo(kind == .list ? "saveLists" : "saveTags", input: input)
			guard generation == home else { return false }
			await loadOrganization()
			await refresh()
			return true
		} catch {
			if generation == home { errorMessage = error.localizedDescription }
			return false
		}
	}
	func loadHistory(_ todo: TobyTodo) async {
		let home = generation
		do {
			let result = try await client.fetchTodoHistory(todo.id)
			if generation == home && selectedOccurrenceId == todo.occurrenceId { history = result }
		} catch { if generation == home { errorMessage = error.localizedDescription } }
	}
	func resetForHomeSwitch() {
		generation = UUID()
		requestId = UUID()
		todos = []; lists = []; tags = []; projects = []; history = []
		total = 0; selectedOccurrenceId = nil; linkedTodo = nil
		filter = .inbox; query = ""; listId = ""; tagId = ""; projectId = ""
		cancelEditor()
		isLoading = false; isSaving = false; errorMessage = nil; syncStatus = nil
		pendingComplete = nil; pendingDelete = nil; isShowingOrganization = false
	}
}

enum TodoOrganizationKind: String, Sendable {
	case list, tag
}
