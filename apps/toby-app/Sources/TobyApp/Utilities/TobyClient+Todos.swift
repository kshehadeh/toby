import Foundation

extension TobyClient {
	func todoRequest<T: Decodable>(_ path: String = "", query: [String: String] = [:], action: [String: Any]? = nil) async throws -> T {
		guard var components = URLComponents(url: baseURL.appendingPathComponent("api/todos\(path)"), resolvingAgainstBaseURL: false) else {
			throw TobyClientError.invalidResponse
		}
		components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
		guard let url = components.url else { throw TobyClientError.invalidResponse }
		var request = URLRequest(url: url)
		request.cachePolicy = .reloadIgnoringLocalCacheData
		if let action {
			request.httpMethod = "POST"
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = try JSONSerialization.data(withJSONObject: action)
		}
		let (data, response) = try await URLSession.shared.data(for: request)
		guard let http = response as? HTTPURLResponse else { throw TobyClientError.invalidResponse }
		if !(200..<300).contains(http.statusCode) {
			let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
			throw TobyClientError.serverError(object?["error"] as? String ?? "Todo request failed (\(http.statusCode)).")
		}
		return try JSONDecoder().decode(T.self, from: data)
	}

	func listTodos(query: [String: String]) async throws -> TodoPage {
		try await todoRequest(query: query)
	}
	func fetchTodo(_ id: String, sequence: Int? = nil) async throws -> TobyTodo {
		struct Response: Decodable { let todo: TobyTodo }
		let response: Response = try await todoRequest("/\(id)", query: sequence.map { ["sequence": String($0)] } ?? [:])
		return response.todo
	}
	func todoOrganization(_ kind: String) async throws -> [TodoOrganizationItem] {
		struct Response: Decodable { let items: [TodoOrganizationItem] }
		let response: Response = try await todoRequest("/\(kind)")
		return response.items
	}
	func mutateTodo(_ action: String, input: [String: Any]) async throws {
		let _: [String: AnyCodable] = try await todoRequest("/actions/\(action)", action: input)
		NotificationCenter.default.post(name: .todosDidChange, object: nil)
	}
	func fetchTodoHistory(_ id: String) async throws -> [TodoHistoryEntry] {
		struct Response: Decodable { let entries: [TodoHistoryEntry] }
		let response: Response = try await todoRequest("/\(id)/history")
		return response.entries
	}
	func todoSyncStatus() async throws -> TodoSyncStatus {
		try await todoRequest("/sync")
	}
	func syncTodosNow() async throws -> TodoSyncStatus {
		try await todoRequest("/sync", action: [:])
	}
	func reconcileRestoredTodos() async throws -> TodoSyncStatus {
		let status: TodoSyncStatus = try await todoRequest("/reconcile", action: ["confirmMerge": true])
		NotificationCenter.default.post(name: .todosDidChange, object: nil)
		return status
	}
}

extension Notification.Name {
	static let todosDidChange = Notification.Name("todosDidChange")
	static let openTodo = Notification.Name("openTodo")
}
