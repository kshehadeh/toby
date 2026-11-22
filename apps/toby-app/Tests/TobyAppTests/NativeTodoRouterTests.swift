import Foundation
import Testing
@testable import TobyApp
import TobyCore
import TobyStore

/// The native router must emit JSON the existing daemon-era models decode.
@MainActor struct NativeTodoRouterTests {
	private func makeRouter() throws -> (NativeTodoRouter, URL) {
		let directory = FileManager.default.temporaryDirectory.appending(path: "toby-router-\(UUID().uuidString)", directoryHint: .isDirectory)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		let database = try TobyDatabase.inMemory()
		let service = TodoService(writer: database.writer, tobyDirectory: directory)
		return (NativeTodoRouter(actions: TodoActions(service: service), sync: nil), directory)
	}

	private func body(_ object: [String: Any]) throws -> Data {
		try JSONSerialization.data(withJSONObject: object)
	}

	@Test("create, list, get, history and organization decode into app models")
	func roundTripsAppModels() async throws {
		let (router, directory) = try makeRouter()
		defer { try? FileManager.default.removeItem(at: directory) }

		let created = try await router.handle(path: "/actions/create", query: [:], body: body([
			"title": "Pay rent",
			"due": ["date": "2027-01-02", "time": "09:00", "timezone": "UTC"],
			"checklist": ["Find checkbook"],
			"remind": true,
		]))
		struct Created: Decodable { let result: TobyTodo }
		let todo = try JSONDecoder().decode(Created.self, from: created).result
		#expect(todo.title == "Pay rent")

		let page = try JSONDecoder().decode(TodoPage.self, from: try await router.handle(path: "", query: ["limit": "10"], body: nil))
		#expect(page.total == 1)
		#expect(page.todos.first?.id == todo.id)

		struct Single: Decodable { let todo: TobyTodo }
		let fetched = try JSONDecoder().decode(Single.self, from: try await router.handle(path: "/\(todo.id)", query: ["sequence": "0"], body: nil))
		#expect(fetched.todo.id == todo.id)

		_ = try await router.handle(path: "/actions/update", query: [:], body: body(["id": todo.id, "changes": ["title": "Pay rent today"]]))
		struct History: Decodable { let entries: [TodoHistoryEntry] }
		let history = try JSONDecoder().decode(History.self, from: try await router.handle(path: "/\(todo.id)/history", query: [:], body: nil))
		#expect(history.entries.contains { $0.field == "title" })

		struct Items: Decodable { let items: [TodoOrganizationItem] }
		let lists = try JSONDecoder().decode(Items.self, from: try await router.handle(path: "/lists", query: [:], body: nil))
		#expect(lists.items.map(\.id) == ["inbox"])

		let schedule = try JSONDecoder().decode(TodoReminderSchedule.self, from: try await router.handle(path: "/reminders/schedule", query: [:], body: nil))
		#expect(schedule.reminders.count == 1)

		let sync = try JSONDecoder().decode(TodoSyncStatus.self, from: try await router.handle(path: "/sync", query: [:], body: nil))
		#expect(sync.error != nil)
	}

	@Test("domain errors surface as readable client errors")
	func mapsErrors() async throws {
		let (router, directory) = try makeRouter()
		defer { try? FileManager.default.removeItem(at: directory) }
		await #expect(throws: TobyClientError.self) {
			_ = try await router.handle(path: "/actions/create", query: [:], body: try self.body(["title": "x", "remind": true]))
		}
	}
}
