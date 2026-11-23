import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

final class RankRecorder: @unchecked Sendable {
	private let lock = NSLock()
	private var prompts: [(system: String, user: String)] = []
	let reply: JSONValue
	init(_ reply: JSONValue) { self.reply = reply }
	var calls: [(system: String, user: String)] { lock.withLock { prompts } }
	func rank(_ system: String, _ user: String) -> JSONValue {
		lock.withLock { prompts.append((system, user)) }
		return reply
	}
}

private func iso(_ offset: TimeInterval, from now: Date = Date()) -> JSONValue { .string(TodoRecurrence.isoString(now.addingTimeInterval(offset))) }

private func candidate(_ category: String, _ id: String, title: String, subtitle: String? = nil, timestamp: JSONValue? = nil, extra: [String: JSONValue] = [:]) -> FeedCandidate {
	var item: [String: JSONValue] = ["id": .string(id), "title": .string(title)]
	if let subtitle { item["subtitle"] = .string(subtitle) }
	if let timestamp { item["timestamp"] = timestamp }
	item.merge(extra) { _, b in b }
	return FeedCandidate(category: category, providerName: "p", providerDisplayName: "P", item: .object(item))
}

@Suite("Feed pre-filter and rules")
struct FeedPrefilterTests {
	@Test func dropsCalendarHoldsAndFarEvents() {
		let now = Date()
		let kept = FeedPrefilter.prefilter([
			candidate("calendar", "a", title: "Focus time", timestamp: iso(1800, from: now), extra: ["event": ["attendeeCount": 1]]),
			candidate("calendar", "b", title: "Design review", timestamp: iso(1800, from: now), extra: ["event": ["attendeeCount": 4, "notes": "Agenda: decide"]]),
			candidate("calendar", "c", title: "Offsite", timestamp: iso(5 * 86400, from: now)),
		], now: now)
		#expect(kept.map(\.itemID) == ["b"])
		#expect(kept[0].signals.contains("starts in 30 minutes"))
		#expect(kept[0].signals.contains("with 3 other people"))
	}

	@Test func capsBulkEmailAndPenalizesFeedback() {
		let now = Date()
		let bulk = (0 ..< 6).map { candidate("email", "n\($0)", title: "Deal \($0)", subtitle: "Shop <newsletter@shop.com>", timestamp: iso(-60, from: now)) }
		let person = candidate("email", "p", title: "Lunch?", subtitle: "Ana <ana@x.com>", timestamp: iso(-60, from: now))
		let key = FeedPrefilter.feedbackKey(category: "email", providerName: "p", title: nil, subtitle: "Ana <ana@x.com>")
		#expect(key == "email:p:ana@x.com")
		let kept = FeedPrefilter.prefilter(bulk + [person], now: now, feedback: [key!: 2])
		#expect(kept.filter { FeedPrefilter.isBulkEmail($0) }.count == 4)
		let ana = kept.first { $0.itemID == "p" }!
		#expect(ana.score == 45 + 20 - 30)
		#expect(ana.signals.last == "the user marked 2 similar items from this source not relevant")
	}

	@Test func feedbackKeysMatchTheDaemon() {
		#expect(FeedPrefilter.feedbackKey(category: "todos", providerName: "toby", title: "Pay rent #3!", subtitle: nil) == "todos:toby:title:pay rent")
		#expect(FeedPrefilter.feedbackKey(category: "chat", providerName: "slack", title: "x", subtitle: "Ana · #eng") == "chat:slack:#eng")
	}

	@Test func ruleHashMatchesTypeScript() {
		#expect(FeedRules.hash("  Ignore Errands ") == "bf557cd580da48f0")
	}

	@Test func ruleFiltersNeverHideOnMissingFacts() {
		let filter: JSONValue = ["categories": ["tasks"], "providers": [], "listMode": "not_in", "lists": ["Errands"], "assignmentMode": "any", "assignments": []]
		#expect(FeedRules.matches(filter, category: "tasks", providerName: "r", providerDisplayName: nil, subtitle: "Work", task: nil))
		#expect(!FeedRules.matches(filter, category: "tasks", providerName: "r", providerDisplayName: nil, subtitle: "errands", task: nil))
		#expect(!FeedRules.matches(filter, category: "tasks", providerName: "r", providerDisplayName: nil, subtitle: nil, task: nil))
		#expect(!FeedRules.matches(filter, category: "email", providerName: "r", providerDisplayName: nil, subtitle: "Work", task: nil))
	}

	@Test func rankingCapsCalendarExceptNowItems() {
		let cands = (0 ..< 5).map { candidate("calendar", "e\($0)", title: "Meeting \($0)") }
		let ranking: JSONValue = ["items": .array((0 ..< 5).map { i in
			["key": .string("c\(i + 1)"), "tier": .string(i == 4 ? "now" : "today"), "priority": .number(Double(50 + i)), "reason": "r", "actions": ["calendar.prep", "bogus"]]
		})]
		let items = FeedService.items(from: ranking, candidates: cands)
		let got = items.map { $0["id"]?.stringValue ?? "" }
		#expect(got == ["calendar:p:e4", "calendar:p:e3", "calendar:p:e2", "calendar:p:e1"])
		let actions = items[0]["actions"]?.arrayValue?.compactMap { $0["id"]?.stringValue }
		#expect(actions == ["calendar.prep", "snooze", "notRelevant", "dismiss"])
	}
}

@Suite("Feed service")
struct FeedServiceTests {
	let home: URL
	let database: TobyDatabase
	let bridge: FakeBridge
	let todos: TodoService

	init() throws {
		home = try temporaryHome()
		database = try TobyDatabase.inMemory()
		let now = Date()
		bridge = FakeBridge([
			"calendar/search": ["ok": true, "data": ["events": [[
				"uid": "ev1", "summary": "Budget review", "calendar": "Work", "startDate": iso(1800, from: now), "endDate": iso(3600, from: now),
				"attendeeCount": 3, "description": "Agenda: approve Q1",
			]]]],
			"reminders/search": ["ok": true, "data": ["reminders": [["id": "r1", "title": "Buy milk", "list": "Errands", "priority": 1]]]],
			"reminders/complete": ["ok": true, "data": ["ok": true]],
		])
		todos = TodoService(writer: database.writer, tobyDirectory: home)
		_ = try todos.create(["title": "Ship release", "priority": "high"], context: TodoMutationContext(source: "test"))
	}

	static let guidance: @Sendable (String, [FeedCandidate]) async -> JSONValue = { text, _ in
		["status": "guidance", "hash": .string(FeedRules.hash(text)), "at": .string(TodoRecurrence.isoString(Date()))]
	}

	func service(_ recorder: RankRecorder, compile: @escaping @Sendable (String, [FeedCandidate]) async -> JSONValue = Self.guidance) throws -> FeedService {
		let apple = AppleTools(bridge: bridge)
		return try FeedService(
			sources: [CalendarFeedSource(apple: apple), RemindersFeedSource(apple: apple)],
			todos: todos, memory: MemoryService(writer: database.writer), personas: PersonaService(tobyDirectory: home),
			ai: OpenRouterClient(keyProvider: StaticAPIKey("sk-or-test"), transport: MockTransport([])), tobyDirectory: home,
			rank: { system, user in recorder.rank(system, user) },
			compileRule: compile,
		)
	}

	static let allThree: JSONValue = ["items": [
		["key": "c1", "tier": "now", "priority": 90, "reason": "Starts soon.", "actions": ["calendar.prep", "todo.add"]],
		["key": "c2", "tier": "today", "priority": 70, "reason": "High priority.", "actions": []],
		["key": "c3", "tier": "today", "priority": 60, "reason": "Errand.", "actions": []],
	]]

	@Test func ranksPersistsAndReusesTheFeed() async throws {
		let recorder = RankRecorder(Self.allThree)
		let feed = try service(recorder)
		let content = try await feed.content()
		#expect(content["status"] == "ok")
		#expect(content["items"]?.arrayValue?.count == 3)
		#expect(recorder.calls.count == 1)
		#expect(recorder.calls[0].user.contains("[calendar] Budget review"))
		#expect(recorder.calls[0].user.contains("[todos] Ship release"))
		#expect(try await feed.persisted() != nil)
		_ = try await feed.content()
		#expect(recorder.calls.count == 1, "fresh cache with the same signature skips re-ranking")
		_ = try await feed.content(force: true)
		#expect(recorder.calls.count == 2)
	}

	@Test func actionsUpdateStateAndSources() async throws {
		let feed = try service(RankRecorder(Self.allThree))
		let content = try await feed.content()
		let ids = content["items"]!.arrayValue!.compactMap { $0["id"]?.stringValue }
		let reminder = try #require(ids.first { $0.hasPrefix("tasks:applereminders") })
		let todo = try #require(ids.first { $0.hasPrefix("todos:toby") })
		let event = try #require(ids.first { $0.hasPrefix("calendar:") })

		let completed = try await feed.perform(itemID: reminder, actionID: "task.complete")
		#expect(completed["ok"] == true)
		#expect(bridge.recorded.contains { $0.0 == "reminders/complete" && $0.1["id"] == "r1" })
		#expect(completed["content"]?["items"]?.arrayValue?.count == 2)

		_ = try await feed.perform(itemID: todo, actionID: "task.complete")
		let open = try todos.list(["status": "open"])["todos"]?.arrayValue ?? []
		#expect(open.isEmpty)

		let added = try await feed.perform(itemID: event, actionID: "todo.add")
		#expect(added["todoId"]?.stringValue != nil)
		#expect(added["content"]?["items"]?.arrayValue?.isEmpty == true)

		let state = try await feed.loadState()
		#expect(state["items"]?[event]?["kind"] == "done")
		#expect(state["items"]?[event]?["action"] == "todo.add")
	}

	@Test func notRelevantRecordsFeedbackAndSnoozeHides() async throws {
		let feed = try service(RankRecorder(Self.allThree))
		let ids = try await feed.content()["items"]!.arrayValue!.compactMap { $0["id"]?.stringValue }
		_ = try await feed.perform(itemID: ids[0], actionID: "notRelevant")
		let snoozed = try await feed.perform(itemID: ids[1], actionID: "snooze")
		#expect(snoozed["message"] == "Snoozed until tomorrow morning.")
		#expect(snoozed["content"]?["items"]?.arrayValue?.count == 1)
		let state = try await feed.loadState()
		#expect(state["feedback"]?.arrayValue?.count == 1)
		await #expect(throws: TodoError.self) { try await feed.perform(itemID: ids[2], actionID: "email.archive") }
	}

	@Test func instructionsAreValidatedAndReachTheRanker() async throws {
		let recorder = RankRecorder(Self.allThree)
		let feed = try service(recorder)
		await #expect(throws: TodoError.self) { try await feed.addInstruction("   ") }
		let body = try await feed.addInstruction("Put   work first")
		let entry = try #require(body["instructions"]?.arrayValue?.first)
		#expect(entry["text"] == "Put work first")
		#expect(entry["enforcement"] == "pending")
		#expect(entry["rule"] == nil)
		_ = try await feed.content(force: true)
		#expect(try await feed.instructions()["instructions"]?[0]?["enforcement"] == "guidance")
		#expect(recorder.calls.last?.system.contains("USER INSTRUCTIONS — highest priority") == true)
		#expect(recorder.calls.last?.user.contains("- Put work first") == true)
		let id = try #require(entry["id"]?.stringValue)
		#expect(try await feed.setInstruction(id, enabled: false)["instructions"]?[0]?["enabled"] == false)
		#expect(try await feed.removeInstruction(id)["instructions"]?.arrayValue?.isEmpty == true)
	}

	@Test func compiledFiltersHideItemsBeforeRanking() async throws {
		let recorder = RankRecorder(Self.allThree)
		let feed = try service(recorder) { text, candidates in
			#expect(candidates.contains { $0.subtitle == "Errands" })
			return ["status": "filter", "hash": .string(FeedRules.hash(text)), "at": .string(TodoRecurrence.isoString(Date())), "summary": "Hides Errands",
			        "filters": [["categories": ["tasks"], "providers": ["applereminders"], "listMode": "in", "lists": ["errands"], "assignmentMode": "any", "assignments": []]]]
		}
		_ = try await feed.addInstruction("Ignore my errands reminders")
		let content = try await feed.content(force: true)
		#expect(recorder.calls.last?.user.contains("Buy milk") == false)
		#expect(content["items"]?.arrayValue?.count == 2)
		let entry = try await feed.instructions()["instructions"]?[0]
		#expect(entry?["enforcement"] == "filter")
		#expect(entry?["enforcementSummary"] == "Hides Errands")
	}
}

extension FeedServiceTests {
	@Test func convertedTodoStaysInTodosAcrossRefreshAndRetry() async throws {
		let feed = try service(RankRecorder(Self.allThree))
		let items = try await feed.content()["items"]?.arrayValue ?? []
		let event = try #require(items.first { $0["source"]?["category"] == "calendar" }?["id"]?.stringValue)
		let first = try await feed.perform(itemID: event, actionID: "todo.add")
		let todoID = try #require(first["todoId"]?.stringValue)
		let afterRestart = try service(RankRecorder(Self.allThree))
		let retry = try await afterRestart.perform(itemID: event, actionID: "todo.add")
		#expect(retry["todoId"] == first["todoId"])
		let refreshed = try await afterRestart.content(force: true)["items"]?.arrayValue ?? []
		#expect(!refreshed.contains { $0["id"]?.stringValue == event || $0["source"]?["itemId"]?.stringValue == todoID })
		let open = try todos.list(["status": "open"])["todos"]?.arrayValue ?? []
		#expect(open.filter { $0["title"] == "Budget review" }.count == 1)
	}

	@Test func importsBeforeRefreshAndKeepsOldDismissalsOnDisk() async throws {
		let paths = TobyPaths(root: home)
		let old: JSONValue = ["items": ["tasks:applereminders:r1": ["kind": "dismissed", "at": "2020-01-01T00:00:00Z"]], "instructions": []]
		let file = home.appending(path: "dashboard-feed-state.json")
		try Data("invalid".utf8).write(to: file)
		let db = try TobyDatabase.open(paths: paths)
		#expect(throws: DecodingError.self) { try FeedDatabase(writer: db.writer, home: home) }
		try Data(old.jsonString().utf8).write(to: file)
		_ = try FeedDatabase(writer: db.writer, home: home)
		try Data("{}".utf8).write(to: file)
		let reopened = try TobyDatabase.open(paths: paths)
		let feed = try FeedService(
			sources: [RemindersFeedSource(apple: AppleTools(bridge: bridge))],
			todos: TodoService(writer: reopened.writer, tobyDirectory: home), memory: MemoryService(writer: reopened.writer),
			personas: PersonaService(tobyDirectory: home), ai: OpenRouterClient(keyProvider: StaticAPIKey("test")),
			tobyDirectory: home, rank: { _, _ in Self.allThree }
		)
		#expect(try await feed.content(force: true)["items"]?.arrayValue == [])
		#expect(try await feed.loadState()["items"]?["tasks:applereminders:r1"]?["kind"] == "dismissed")
	}
}

private actor PausedFeedRank {
	private var calls = 0
	private var started: CheckedContinuation<Void, Never>?
	private var resume: CheckedContinuation<Void, Never>?

	func rank() async -> JSONValue {
		calls += 1
		if calls == 2 {
			await withCheckedContinuation {
				resume = $0
				started?.resume()
				started = nil
			}
		}
		return FeedServiceTests.allThree
	}

	func waitForRank() async {
		if resume == nil { await withCheckedContinuation { started = $0 } }
	}

	func finish() { resume?.resume(); resume = nil }
}

extension FeedServiceTests {
	@Test func dismissalDuringRankingSurvivesLateResult() async throws {
		let paused = PausedFeedRank()
		let feed = try FeedService(
			sources: [CalendarFeedSource(apple: AppleTools(bridge: bridge))],
			todos: todos, memory: MemoryService(writer: database.writer), personas: PersonaService(tobyDirectory: home),
			ai: OpenRouterClient(keyProvider: StaticAPIKey("test")), tobyDirectory: home, rank: { _, _ in await paused.rank() }
		)
		let first = try await feed.content()
		let id = try #require(first["items"]?[0]?["id"]?.stringValue)
		let refresh = Task { try await feed.content(force: true) }
		await paused.waitForRank()
		_ = try await feed.perform(itemID: id, actionID: "dismiss")
		await paused.finish()
		let returned = try await refresh.value
		#expect(returned["items"]?.arrayValue?.contains { $0["id"]?.stringValue == id } == false)
		let next = try await feed.content()
		#expect(next["items"]?.arrayValue?.contains { $0["id"]?.stringValue == id } == false)
	}
}

extension FeedServiceTests {
	@Test func nextTodoOccurrenceHasItsOwnActions() async throws {
		let created = try todos.create(["title": "Daily", "priority": "high", "due": due("2026-01-01"), "recurrence": calendarRule("day")])
		let id = try #require(created["id"]?.stringValue)
		let feed = try FeedService(
			sources: [], todos: todos, memory: MemoryService(writer: database.writer), personas: PersonaService(tobyDirectory: home),
			ai: OpenRouterClient(keyProvider: StaticAPIKey("test")), tobyDirectory: home, rank: { _, _ in
				["items": .array((1 ... 2).map { ["key": .string("c\($0)"), "tier": "today", "actions": ["task.complete"]] })]
			}
		)
		let initial = try await feed.content()["items"]?.arrayValue ?? []
		let first = try #require(initial.first { $0["source"]?["itemId"]?.stringValue == id }?["id"]?.stringValue)
		_ = try await feed.perform(itemID: first, actionID: "task.complete")
		let next = try await feed.content(force: true)["items"]?.arrayValue ?? []
		#expect(next.contains { $0["source"]?["itemId"]?.stringValue == id && $0["source"]?["sequence"] == 1 && $0["id"]?.stringValue != first })
		#expect(try await feed.perform(itemID: first, actionID: "task.complete")["ok"] == true)
		#expect(try todos.get(id)["sequence"] == 1)
	}
}

extension FeedServiceTests {
	@Test func failedDecisionRollsBackTodoCreation() async throws {
		let feed = try service(RankRecorder(Self.allThree))
		let items = try await feed.content()["items"]?.arrayValue ?? []
		let event = try #require(items.first { $0["source"]?["category"] == "calendar" }?["id"]?.stringValue)
		try await database.writer.write { db in
			try db.execute(sql: "CREATE TRIGGER reject_feed BEFORE INSERT ON feed_decisions BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END")
		}
		await #expect(throws: DatabaseError.self) { try await feed.perform(itemID: event, actionID: "todo.add") }
		let open = try todos.list(["status": "open"])["todos"]?.arrayValue ?? []
		#expect(!open.contains { $0["title"] == "Budget review" })
		#expect(try await feed.storage.decision(event) == nil)
		try await database.writer.write { db in try db.execute(sql: "DROP TRIGGER reject_feed") }
		#expect(try await feed.perform(itemID: event, actionID: "todo.add")["todoId"]?.stringValue != nil)
	}

	@Test func changingRecurringReminderDatePreservesDismissal() throws {
		let storage = try FeedDatabase(writer: database.writer, home: home)
		func reminder(_ date: String) -> FeedCandidate {
			FeedCandidate(category: "tasks", providerName: "applereminders", providerDisplayName: nil,
			              item: ["id": "r1", "title": "Review", "identity": ["scope": "account", "occurrence": .string(date)]])
		}
		let original = try #require(try storage.reconcile([reminder("2026-11-23")]).first)
		try database.writer.write { db in
			try FeedDatabase.record(original.id, ["kind": "dismissed", "at": "2026-11-23T10:00:00Z"], db)
		}
		let edited = try #require(try storage.reconcile([reminder("2026-11-24")]).first)
		#expect(edited.cardID == original.cardID)
		#expect(try FeedDatabase.covered(edited.identity, card: edited.cardID, state: storage.state(), now: Date()))
	}
}

extension FeedServiceTests {
	@Test func recurringCalendarIdentitySurvivesRescheduleAndImportsNotification() throws {
		let oldID = "calendar:applecalendar:old"
		let stamp = "2026-11-23T10:00:00Z"
		let prior: JSONValue = ["id": .string(oldID), "title": "Review", "timestamp": .string(stamp)]
		let state: JSONValue = ["notified": .object([oldID: .string(stamp)])]
		let ranked: JSONValue = ["content": ["items": .array([prior])]]
		try Data(state.jsonString().utf8).write(to: home.appending(path: "dashboard-feed-state.json"))
		try Data(ranked.jsonString().utf8).write(to: home.appending(path: "dashboard-feed.json"))
		let storage = try FeedDatabase(writer: database.writer, home: home)
		func event(_ id: String, occurrence: String, start: String) -> FeedCandidate {
			FeedCandidate(category: "calendar", providerName: "applecalendar", providerDisplayName: nil, item: [
				"id": .string(id), "title": "Review", "timestamp": .string(start),
				"identity": ["scope": "work", "calendar": "primary", "record": "series", "occurrence": .string(occurrence)],
			])
		}
		let original = try #require(try storage.reconcile([event("old", occurrence: stamp, start: stamp)]).first)
		#expect(try !storage.claimNotification(original.id, target: original.id, at: Date()))
		let tomorrow = "2026-11-24T10:00:00Z"
		let updated = try storage.reconcile([event("detached", occurrence: stamp, start: tomorrow), event("next", occurrence: tomorrow, start: tomorrow)])
		#expect(updated[0].id == original.id)
		#expect(updated[1].id != original.id)
	}
}
