import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Parity port of `apps/cli/tests/todos.test.ts`.
final class TodoFixture {
	let directory: URL
	let database: TobyDatabase
	let service: TodoService
	let actions: TodoActions

	init() throws {
		directory = FileManager.default.temporaryDirectory.appending(path: "toby-todos-\(UUID().uuidString)", directoryHint: .isDirectory)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		database = try TobyDatabase.inMemory()
		service = TodoService(writer: database.writer, tobyDirectory: directory)
		actions = TodoActions(service: service)
	}

	deinit { try? FileManager.default.removeItem(at: directory) }

	func create(_ input: [String: JSONValue] = [:], context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		var object: [String: JSONValue] = ["title": "A todo"]
		object.merge(input) { _, new in new }
		return try service.create(.object(object), context: context)
	}

	func ids(_ page: JSONValue) -> [String] {
		(page["todos"]?.arrayValue ?? []).compactMap { $0["id"]?.stringValue }
	}
}

func due(_ date: String, _ time: String? = nil, _ timezone: String = "UTC") -> JSONValue {
	["date": .string(date), "time": time.map(JSONValue.string) ?? .null, "timezone": .string(timezone)]
}

func calendarRule(_ unit: String, _ interval: Int = 1) -> JSONValue {
	["mode": "calendar", "unit": .string(unit), "interval": .number(Double(interval))]
}

func expectTodoError(_ fragment: String, _ body: () throws -> Void, sourceLocation: SourceLocation = #_sourceLocation) {
	do {
		try body()
		Issue.record("Expected an error containing “\(fragment)”", sourceLocation: sourceLocation)
	} catch let error as TodoError {
		#expect(error.message.contains(fragment), "\(error.message)", sourceLocation: sourceLocation)
	} catch {
		Issue.record("Unexpected error \(error)", sourceLocation: sourceLocation)
	}
}

@Suite("Toby todo domain")
struct TodoServiceTests {
	@Test func seedsInboxAndSupportsFieldsFiltersPaginationAndClearing() throws {
		let f = try TodoFixture()
		#expect(try f.service.organization("list") == [["id": "inbox", "name": "Inbox"]])
		let a = try f.create(["description": "needle", "priority": "high", "projectId": "project", "due": due("2027-01-02")])
		_ = try f.create(["title": "Other"])
		let filtered = try f.service.list(["query": "needle", "priority": "high", "projectId": "project"])
		#expect(f.ids(filtered) == [a["id"]?.stringValue ?? ""])
		#expect(try f.service.list(["limit": 1, "offset": 1])["todos"]?.arrayValue?.count == 1)
		let id = try #require(a["id"]?.stringValue)
		_ = try f.service.update(id, ["due": .null, "projectId": .null])
		let updated = try f.service.get(id)
		#expect(updated["due"] == .null)
		#expect(updated["projectId"] == .null)
		#expect(updated["description"] == "needle")
	}

	@Test func previewsWithoutPersistenceAndEnforcesRevisions() throws {
		let f = try TodoFixture()
		#expect(try f.service.create(["title": "Preview"], context: TodoMutationContext(dryRun: true))["dryRun"] == true)
		#expect(try f.service.list()["total"] == 0)
		let item = try f.create()
		let id = try #require(item["id"]?.stringValue)
		let revision = item["revision"]?.stringValue
		_ = try f.service.update(id, ["title": "Changed"], context: TodoMutationContext(expectedRevision: revision))
		expectTodoError("changed") {
			_ = try f.service.update(id, ["title": "Stale"], context: TodoMutationContext(expectedRevision: revision))
		}
	}

	@Test func replaysMutationResultsAndRejectsIdempotencyKeyReuse() throws {
		let f = try TodoFixture()
		let first = try f.service.create(["title": "Once"], context: TodoMutationContext(idempotencyKey: "create-once"))
		#expect(try f.service.create(["title": "Once"], context: TodoMutationContext(idempotencyKey: "create-once")) == first)
		#expect(try f.service.list()["total"] == 1)
		expectTodoError("different inputs") {
			_ = try f.service.create(["title": "Different"], context: TodoMutationContext(idempotencyKey: "create-once"))
		}
	}

	@Test func removesListsAndTagsWithoutDeletingTheirTodos() throws {
		let f = try TodoFixture()
		let list = try #require(try f.service.saveOrganization("list", id: nil, name: "Work", remove: false)["id"]?.stringValue)
		let tag = try #require(try f.service.saveOrganization("tag", id: nil, name: "Urgent", remove: false)["id"]?.stringValue)
		let item = try f.create(["listId": .string(list), "tags": [.string(tag)]])
		let id = try #require(item["id"]?.stringValue)
		_ = try f.service.saveOrganization("list", id: list, name: nil, remove: true)
		_ = try f.service.saveOrganization("tag", id: tag, name: nil, remove: true)
		let current = try f.service.get(id)
		#expect(current["listId"] == "inbox")
		#expect(current["tags"] == [])
		#expect(current["deleted"] == false)
		expectTodoError("Inbox") { _ = try f.service.saveOrganization("list", id: "inbox", name: nil, remove: true) }
		expectTodoError("deleted") { _ = try f.service.setTag(id, tagID: tag, enabled: true) }
	}

	@Test func requiresChecklistAcknowledgementAndPreservesHistory() throws {
		let f = try TodoFixture()
		let item = try f.create(["checklist": ["First", "Second"]])
		let id = try #require(item["id"]?.stringValue)
		expectTodoError("unfinished") { _ = try f.service.transition(id, action: "complete", sequence: nil) }
		var first = try #require(item["checklist"]?[0]?.objectValue)
		first["checked"] = true
		_ = try f.service.setChecklistItem(id, item: .object(first))
		#expect(try f.service.get(id)["checklist"]?.arrayValue?.filter { $0["checked"] == true }.count == 1)
		_ = try f.service.transition(id, action: "complete", sequence: nil, allowIncompleteChecklist: true)
		_ = try f.service.delete(id)
		#expect(try f.service.list(["status": "deleted"])["total"] == 1)
		expectTodoError("Restore") { _ = try f.service.update(id, ["title": "Cannot edit"]) }
		_ = try f.service.delete(id, restore: true)
		#expect(try f.service.list(["status": "completed"])["total"] == 1)
		#expect(try f.service.historyOperations(id).count == 5)
	}

	@Test func doesNotInventMidnightRemindersForDateOnlyDeadlines() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create(["due": due("2027-01-02")])["id"]?.stringValue)
		expectTodoError("explicit reminder time") {
			_ = try f.service.setReminder(id, reminder: ["id": "reminder", "offsetMinutes": 0])
		}
		_ = try f.service.setReminder(id, reminder: ["id": "reminder", "at": "2027-01-02T09:00:00Z"])
		#expect(try f.service.get(id)["reminders"]?.arrayValue?.count == 1)
	}

	@Test func attachesDueTimeReminderOnCreate() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create(["due": due("2027-01-02", "09:00"), "remind": true])["id"]?.stringValue)
		#expect(try f.service.get(id)["reminders"] == [["id": "due", "at": .null, "offsetMinutes": 0, "snoozedUntil": .null]])
		#expect(try f.service.historyOperations(id).count == 1)
	}

	@Test func refusesRemindWithoutATime() throws {
		let f = try TodoFixture()
		expectTodoError("due date with a time") { _ = try f.create(["due": due("2027-01-02"), "remind": true]) }
		expectTodoError("due date with a time") { _ = try f.create(["remind": true]) }
		#expect(try f.service.list()["total"] == 0)
	}

	@Test func attachesReminderThroughActionAdapter() throws {
		let f = try TodoFixture()
		let created = try f.actions.execute("create", input: ["title": "Tool path", "due": due("2027-01-03", "08:30"), "remind": true])
		let id = try #require(created["id"]?.stringValue)
		let reminder = try f.service.get(id)["reminders"]?[0]
		#expect(reminder?["id"] == "due")
		#expect(reminder?["offsetMinutes"] == 0)
	}

	@Test func keepsCompletedSnapshotsAndCarriesRelativeRemindersForward() throws {
		let f = try TodoFixture()
		let item = try f.create(["due": due("2027-01-01", "09:00"), "recurrence": calendarRule("day"), "checklist": ["Original"]])
		let id = try #require(item["id"]?.stringValue)
		let original = try #require(item["checklist"]?[0]?.objectValue)
		var checked = original
		checked["checked"] = true
		_ = try f.service.setChecklistItem(id, item: .object(checked))
		_ = try f.service.setReminder(id, reminder: ["id": "due", "offsetMinutes": 15, "snoozedUntil": "2027-01-01T10:00:00Z"])
		_ = try f.service.transition(id, action: "complete", sequence: 0, context: TodoMutationContext(now: "2027-01-01T12:00:00Z"))
		let reminder = try f.service.get(id)["reminders"]?[0]
		#expect(reminder?["offsetMinutes"] == 15)
		#expect(reminder?["snoozedUntil"] == .null)
		_ = try f.service.update(id, ["due": due("2027-02-01"), "recurrence": .null, "scope": "series"])
		var changed = original
		changed["text"] = "Changed"
		changed["checked"] = false
		_ = try f.service.setChecklistItem(id, item: .object(changed))
		let past = try f.service.get(id, sequence: 0)
		#expect(past["due"] == due("2027-01-01", "09:00"))
		#expect(past["checklist"] == [.object(checked)])
	}

	@Test func advancesJustOnceAcrossMissedRepeatsAndRetries() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create(["due": due("2027-01-01"), "recurrence": calendarRule("day")])["id"]?.stringValue)
		let context = TodoMutationContext(idempotencyKey: "completion", now: "2027-01-10T12:00:00Z")
		let result = try f.service.transition(id, action: "complete", sequence: 0, context: context)
		let current = try f.service.get(id)
		#expect(current["sequence"] == 1)
		#expect(current["due"] == due("2027-01-11"))
		#expect(current["state"]?["status"] == "open")
		#expect(try f.service.transition(id, action: "complete", sequence: 0, context: context) == result)
		expectTodoError("already closed") { _ = try f.service.transition(id, action: "complete", sequence: 0) }
		#expect(try f.service.list(["status": "completed"])["total"] == 1)
	}

	@Test func keepsOccurrenceEditsSeparateFromSeries() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create(["title": "Series", "due": due("2027-01-01"), "recurrence": calendarRule("day")])["id"]?.stringValue)
		_ = try f.service.update(id, ["title": "Just this one", "scope": "occurrence"])
		#expect(try f.service.get(id)["title"] == "Just this one")
		_ = try f.service.transition(id, action: "complete", sequence: 0, context: TodoMutationContext(now: "2027-01-01T12:00:00Z"))
		#expect(try f.service.get(id)["title"] == "Series")
		_ = try f.service.update(id, ["title": "New series", "scope": "series"])
		#expect(try f.service.get(id)["title"] == "New series")
		#expect(try f.service.get(id, sequence: 0)["title"] == "Just this one")
	}

	@Test func reopensUntouchedSuccessorButRefusesToOverwriteLaterWork() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create(["due": due("2027-01-01"), "recurrence": calendarRule("day")])["id"]?.stringValue)
		let noon = TodoMutationContext(now: "2027-01-01T12:00:00Z")
		_ = try f.service.transition(id, action: "complete", sequence: 0, context: noon)
		_ = try f.service.transition(id, action: "reopen", sequence: 0)
		#expect(try f.service.get(id)["sequence"] == 0)
		_ = try f.service.transition(id, action: "skip", sequence: 0, context: noon)
		_ = try f.service.update(id, ["due": due("2027-01-03")])
		expectTodoError("Later occurrences") { _ = try f.service.transition(id, action: "reopen", sequence: 0) }
	}

	@Test func historyEntriesAndFieldRestore() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create(["title": "Original"])["id"]?.stringValue)
		_ = try f.service.update(id, ["title": "Edited", "scope": "series"])
		let entries = try f.service.historyEntries(id)
		let past = try #require(entries.first { $0["field"] == "title" && $0["value"] == "Original" })
		#expect(past["restorable"] == true)
		#expect(entries.first { $0["field"] == "title" && $0["value"] == "Edited" }?["current"] == true)
		_ = try f.actions.execute("restoreField", input: ["id": .string(id), "operationId": past["operationId"] ?? .null, "field": "title"])
		#expect(try f.service.get(id)["title"] == "Original")
	}

	@Test func touchesChangeMarkerOnMutation() throws {
		let f = try TodoFixture()
		let marker = f.directory.appending(path: ".todos-changed")
		#expect(!FileManager.default.fileExists(atPath: marker.path))
		_ = try f.create()
		#expect(FileManager.default.fileExists(atPath: marker.path))
	}

	@Test func actionEnvelopeLiftsDryRunAndRejectsUnknownActions() throws {
		let f = try TodoFixture()
		#expect(try f.actions.execute("create", input: ["title": "Dry", "dryRun": true])["dryRun"] == true)
		#expect(try f.service.list()["total"] == 0)
		#expect(throws: TodoError.self) { try f.actions.execute("explode", input: [:]) }
		#expect(throws: TodoError.self) { try f.actions.execute("create", input: ["title": "x", "bogus": 1]) }
	}

	@Test func summaryAndReminderSchedule() throws {
		let f = try TodoFixture()
		_ = try f.create(["title": "Pay [rent]", "due": due("2027-01-02", "09:00"), "remind": true])
		let summary = try f.service.summary(now: TodoRecurrence.parseISO("2027-01-03T00:00:00Z")!, timezone: TimeZone(identifier: "UTC")!)
		#expect(summary["count"] == 1)
		#expect(summary["markdown"]?.stringValue?.contains("Pay \\[rent\\]") == true)
		#expect(summary["overdue"]?.arrayValue?.count == 1)
		let schedule = try f.service.reminderSchedule()
		#expect(schedule["reminders"]?[0]?["at"] == "2027-01-02T09:00:00.000Z")
	}
}

@Suite("Todo recurrence")
struct TodoRecurrenceTests {
	func rule(_ value: JSONValue) -> JSONValue { value }

	@Test func validatesCalendarDates() {
		for value in ["2027-02-29", "2027-99-99", "not-a-date"] {
			#expect(!TodoSchema.isDate(value))
		}
		#expect(TodoSchema.isDate("2028-02-29"))
	}

	@Test func preservesMonthEndAndLeapYearAnchors() throws {
		let anchor = TodoDue(date: "2027-01-31")
		let feb = try #require(TodoRecurrence.nextDue(anchor: anchor, current: anchor, rule: calendarRule("month"), completedAt: "2027-01-31T12:00:00Z"))
		#expect(feb.date == "2027-02-28")
		#expect(TodoRecurrence.nextDue(anchor: anchor, current: feb, rule: calendarRule("month"), completedAt: "2027-02-28T12:00:00Z")?.date == "2027-03-31")
		let leap = TodoDue(date: "2028-02-29")
		#expect(TodoRecurrence.nextDue(anchor: leap, current: leap, rule: calendarRule("year"), completedAt: "2028-02-29T12:00:00Z")?.date == "2029-02-28")
	}

	@Test func doesNotRecreateCurrentSlotWhenCompletedEarly() {
		let anchor = TodoDue(date: "2027-01-05", time: "09:00")
		#expect(TodoRecurrence.nextDue(anchor: anchor, current: anchor, rule: calendarRule("day"), completedAt: "2027-01-01T12:00:00Z")?.date == "2027-01-06")
	}

	@Test func usesLocalDaysAndWeekdaysWithEndDate() {
		let anchor = TodoDue(date: "2027-01-04", time: "09:00", timezone: "America/New_York")
		var weekly = calendarRule("week").objectValue!
		weekly["weekdays"] = [1, 3, 5]
		weekly["endDate"] = "2027-01-06"
		let rule = JSONValue.object(weekly)
		#expect(TodoRecurrence.nextDue(anchor: anchor, current: anchor, rule: rule, completedAt: "2027-01-04T15:00:00Z")?.date == "2027-01-06")
		#expect(TodoRecurrence.nextDue(
			anchor: anchor,
			current: TodoDue(date: "2027-01-06", time: "09:00", timezone: "America/New_York"),
			rule: rule,
			completedAt: "2027-01-06T15:00:00Z",
		) == nil)
	}

	@Test func everyOtherWeekRespectsInterval() {
		let anchor = TodoDue(date: "2027-01-04", time: "09:00", timezone: "UTC")
		var rule = calendarRule("week", 2).objectValue!
		rule["weekdays"] = [1]
		#expect(TodoRecurrence.nextDue(anchor: anchor, current: anchor, rule: .object(rule), completedAt: "2027-01-04T10:00:00Z")?.date == "2027-01-18")
	}

	@Test func resolvesDSTGapsForwardAndOverlapsEarlier() {
		#expect(TodoRecurrence.dueInstant(TodoDue(date: "2027-03-14", time: "02:30", timezone: "America/New_York")).map(TodoRecurrence.isoString) == "2027-03-14T07:30:00.000Z")
		#expect(TodoRecurrence.dueInstant(TodoDue(date: "2027-11-07", time: "01:30", timezone: "America/New_York")).map(TodoRecurrence.isoString) == "2027-11-07T05:30:00.000Z")
	}

	@Test func keepsDateOnlyItemsCurrentUntilDayEnds() {
		let item = TodoDue(date: "2027-01-01", timezone: "America/Los_Angeles")
		#expect(!TodoRecurrence.isOverdue(item, now: TodoRecurrence.parseISO("2027-01-02T07:59:00Z")!))
		#expect(TodoRecurrence.isOverdue(item, now: TodoRecurrence.parseISO("2027-01-02T08:00:00Z")!))
	}

	@Test func completionRepeatsAdvanceFromCompletion() {
		let anchor = TodoDue(date: "2027-01-01", time: "09:00")
		#expect(TodoRecurrence.nextDue(
			anchor: anchor,
			current: anchor,
			rule: ["mode": "completion", "unit": "day", "interval": 3],
			completedAt: "2027-01-10T15:45:00Z",
		) == TodoDue(date: "2027-01-13", time: "15:45"))
	}
}

@Suite("Todo operations")
struct TodoOperationTests {
	@Test func redeliveryWithDifferentKeyOrderIsNotAConflict() throws {
		let f = try TodoFixture()
		let id = try #require(try f.create()["id"]?.stringValue)
		let op = try #require(try f.service.historyOperations(id).first)
		// Re-encode with a different key order, as the TS daemon would.
		let reordered = try JSONValue(parsing: String(decoding: JSONSerialization.data(withJSONObject: JSONSerialization.jsonObject(with: Data(op.jsonString().utf8))), as: UTF8.self))
		let parsed = try TodoOperation.parse(reordered)
		let applied = try f.database.writer.write { db in try f.service.store.apply(db, parsed) }
		#expect(!applied)

		var tampered = parsed
		tampered.source = "evil"
		#expect(throws: TodoError.self) {
			try f.database.writer.write { db in try f.service.store.apply(db, tampered) }
		}
	}

	@Test func rejectsInvalidChangeFields() {
		let op: JSONValue = [
			"version": 1, "id": "op1", "replica": "r1", "clock": 1, "at": "2027-01-01T00:00:00Z", "source": "sync",
			"changes": [["kind": "todo", "id": "t1", "fields": ["priority": "urgent"]]],
		]
		#expect(throws: TodoError.self) { try TodoOperation.parse(op) }
	}

	@Test func lastWriterWinsByStamp() throws {
		let f = try TodoFixture()
		func op(_ id: String, clock: Int, replica: String, title: String) throws -> TodoOperation {
			try TodoOperation.parse([
				"version": 1, "id": .string(id), "replica": .string(replica), "clock": .number(Double(clock)),
				"at": "2027-01-01T00:00:00Z", "source": "sync",
				"changes": [["kind": "todo", "id": "t1", "fields": [
					"title": .string(title), "createdAt": "2027-01-01T00:00:00Z", "updatedAt": "2027-01-01T00:00:00Z",
				]]],
			])
		}
		try f.database.writer.write { db in
			try f.service.store.apply(db, try op("b", clock: 5, replica: "r2", title: "Newer"))
			try f.service.store.apply(db, try op("a", clock: 3, replica: "r1", title: "Older"))
		}
		#expect(try f.service.get("t1")["title"] == "Newer")
	}
}
