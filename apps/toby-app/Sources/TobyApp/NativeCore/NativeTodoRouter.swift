import Foundation
import TobyAI
import TobyCore

/// Serves the daemon's `/api/todos` routes in-process from `TobyCore`, so the
/// existing stores and views run unchanged in native mode.
struct NativeTodoRouter {
	let actions: TodoActions
	let sync: (any NativeTodoSyncing)?

	var service: TodoService { actions.service }

	/// Handle `path` (relative to `/api/todos`) and return the JSON body.
	/// `body` is the JSON request body for POST routes (nil for GET).
	func handle(path: String, query: [String: String], body: Data?) async throws -> Data {
		let result = try await route(path: path, query: query, body: body)
		return Data(result.jsonString().utf8)
	}

	func route(path: String, query: [String: String], body: Data?) async throws -> JSONValue {
		do {
			let input = try body.map { try JSONDecoder().decode(JSONValue.self, from: $0) }
			return try await dispatch(path: path, query: query, input: input)
		} catch let error as TodoError {
			throw TobyClientError.serverError(error.message)
		}
	}

	private func dispatch(path: String, query: [String: String], input: JSONValue?) async throws -> JSONValue {

		switch path {
		case "":
			var filter: [String: JSONValue] = [:]
			for (key, value) in query {
				filter[key] = ["limit", "offset"].contains(key) ? .number(Double(value) ?? 0) : .string(value)
			}
			return try service.list(.object(filter))
		case "/lists":
			return ["items": .array(try service.organization("list"))]
		case "/tags":
			return ["items": .array(try service.organization("tag"))]
		case "/reminders/schedule":
			return try service.reminderSchedule()
		case "/sync":
			guard let sync else { return syncUnavailable() }
			return input == nil ? try await sync.status() : try await sync.syncNow()
		case "/reconcile":
			guard input?["confirmMerge"] == true else {
				throw TodoError("confirmation_required", "Review the restored todos and confirm merging with the sync destination.")
			}
			guard let sync else { return syncUnavailable() }
			return try await sync.reconcile()
		default:
			break
		}

		if path.hasPrefix("/actions/"), let input {
			let name = String(path.dropFirst("/actions/".count))
			return ["result": try actions.execute(name, input: input, context: TodoMutationContext(source: "api"))]
		}
		let parts = path.split(separator: "/").map(String.init)
		if parts.count == 2, parts[1] == "history" {
			return [
				"history": .array(try service.historyOperations(parts[0])),
				"entries": .array(try service.historyEntries(parts[0])),
			]
		}
		if parts.count == 1 {
			return ["todo": try service.get(parts[0], sequence: query["sequence"].flatMap(Int.init))]
		}
		throw TobyClientError.serverError("Not found")
	}

	private func syncUnavailable() -> JSONValue {
		[
			"pausedForRestore": .bool(service.needsRestoreReview),
			"lastSuccess": .null,
			"error": "Todo sync isn’t available in native mode yet.",
			"pending": 0,
		]
	}
}

/// Native todo sync (iCloud batches), injected once ported.
protocol NativeTodoSyncing: Sendable {
	func status() async throws -> JSONValue
	func syncNow() async throws -> JSONValue
	func reconcile() async throws -> JSONValue
}
