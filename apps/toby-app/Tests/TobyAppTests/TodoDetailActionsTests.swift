import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Todo detail actions")
struct TodoDetailActionsTests {
	private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
		try JSONDecoder().decode(type, from: Data(json.utf8))
	}
	private func todo(time: String? = "09:30", status: String = "open") throws -> TobyTodo {
		let timeJSON = time.map { "\"\($0)\"" } ?? "null"
		return try decode(TobyTodo.self, """
		{"id":"todo","revision":"r","title":"Pay rent","description":"","priority":"none","listId":"inbox",
		 "projectId":null,"projectLabel":null,"tags":[],"due":{"date":"2027-01-02","time":\(timeJSON),"timezone":"UTC"},
		 "recurrence":null,"deleted":false,"occurrenceId":"todo:0","sequence":0,"state":{"status":"\(status)","at":null},
		 "checklist":[],"reminders":[{"id":"r1","at":null,"offsetMinutes":60,"snoozedUntil":null}]}
		""")
	}

	@Test("History entries describe values and flag superseded ones")
	func historyEntries() throws {
		let entries = try decode([TodoHistoryEntry].self, """
		[{"operationId":"a","at":"2027-01-01T10:00:00.000Z","source":"chat","replica":"x","kind":"todo","entityId":"todo",
		  "field":"title","value":"Old title","current":false,"restorable":true},
		 {"operationId":"b","at":"2027-01-01T11:00:00.000Z","source":"api","replica":"y","kind":"occurrence","entityId":"todo:0",
		  "field":"check:i","value":{"id":"i","text":"Call","order":0,"checked":true},"current":true,"restorable":false},
		 {"operationId":"c","at":"2027-01-01T12:00:00.000Z","source":"api","replica":"y","kind":"todo","entityId":"todo",
		  "field":"tag:home","value":false,"current":true,"restorable":false}]
		""")
		#expect(entries.map(\.fieldTitle) == ["Title", "Checklist item", "Tag"])
		#expect(entries.map(\.valueText) == ["Old title", "Done: Call", "Removed"])
		#expect(entries[0].restorable && !entries[0].current)
		#expect(Set(entries.map(\.id)).count == 3)
	}

	@Test("Reminder labels and repeat summaries are readable")
	func labels() {
		#expect(TodoReminder(id: "a", at: nil, offsetMinutes: 0, snoozedUntil: nil).label == "At due time")
		#expect(TodoReminder(id: "a", at: nil, offsetMinutes: 60, snoozedUntil: nil).label == "1 hour before due")
		#expect(TodoReminder(id: "a", at: nil, offsetMinutes: 2880, snoozedUntil: nil).label == "2 days before due")
		#expect(TodoReminder(id: "a", at: nil, offsetMinutes: 60, snoozedUntil: "2027-01-02T09:00:00Z").label.hasPrefix("Snoozed until"))
		#expect(TodoRecurrence(mode: "calendar", unit: "week", interval: 2, weekdays: [1, 3], endDate: nil).summary == "Every 2 weeks on Mon, Wed")
		#expect(TodoRecurrence(mode: "completion", unit: "day", interval: 1, weekdays: nil, endDate: "2027-05-01").summary == "1 day after completion until 2027-05-01")
	}

	@Test("Snoozing until tomorrow lands at 9 AM on the next day")
	func tomorrowMorning() throws {
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
		let now = try #require(ISO8601DateFormatter().date(from: "2027-03-13T23:30:00Z"))
		let result = TodoRemindersSection.tomorrowMorning(now: now, calendar: calendar)
		let parts = calendar.dateComponents([.day, .hour, .minute], from: result)
		#expect(parts.day == 14 && parts.hour == 9 && parts.minute == 0)
	}

	@Test("Timed todos offer due-relative reminders; date-only todos explain the requirement")
	func reminderControls() throws {
		let store = TodosStore()
		let timed = TodoRemindersSection(store: store, todo: try todo(), isEditable: true)
		#expect(try timed.inspect().find(text: "1 hour before due").string() == "1 hour before due")
		#expect(throws: Never.self) { try timed.inspect().find(button: "1 day before") }
		let dateOnly = try todo(time: nil)
		let section = TodoRemindersSection(store: store, todo: TobyTodo(copying: dateOnly, reminders: []), isEditable: true)
		#expect(try section.inspect().find(text: "No reminders. Date-only todos need a specific reminder time.").string().contains("Date-only"))
		#expect(throws: (any Error).self) { try section.inspect().find(button: "1 day before") }
	}

	@Test("Completed todos hide editing controls")
	func readOnlyWhenClosed() throws {
		let store = TodosStore()
		let detail = TodoDetailView(store: store, todo: try todo(status: "completed"))
		#expect(throws: Never.self) { try detail.inspect().find(button: "Reopen") }
		#expect(throws: (any Error).self) { try detail.inspect().find(button: "Delete") }
		#expect(throws: (any Error).self) { try detail.inspect().find(button: "Snooze") }
	}

	@Test("Lists and tags sheet keeps Inbox fixed and offers creation")
	func organizationSheet() throws {
		let store = TodosStore()
		store.lists = try decode([TodoOrganizationItem].self, #"[{"id":"inbox","name":"Inbox"},{"id":"work","name":"Work"}]"#)
		store.tags = []
		let sheet = TodoOrganizationSheet(store: store)
		#expect(try sheet.inspect().find(text: "Work").string() == "Work")
		#expect(try sheet.inspect().find(text: "No tags yet.").string() == "No tags yet.")
		#expect(throws: (any Error).self) { try sheet.inspect().find(button: "Delete Inbox") }
		#expect(throws: Never.self) { try sheet.inspect().find(button: "Delete Work") }
	}

	@Test("Home reset closes the lists and tags sheet")
	func resetClosesOrganization() {
		let store = TodosStore()
		store.isShowingOrganization = true
		store.resetForHomeSwitch()
		#expect(!store.isShowingOrganization)
	}
}

extension TobyTodo {
	init(copying todo: TobyTodo, reminders: [TodoReminder]) {
		self.init(id: todo.id, revision: todo.revision, title: todo.title, description: todo.description,
			priority: todo.priority, listId: todo.listId, projectId: todo.projectId, projectLabel: todo.projectLabel,
			tags: todo.tags, due: todo.due, recurrence: todo.recurrence, deleted: todo.deleted,
			occurrenceId: todo.occurrenceId, sequence: todo.sequence, state: todo.state,
			checklist: todo.checklist, reminders: reminders)
	}
}
