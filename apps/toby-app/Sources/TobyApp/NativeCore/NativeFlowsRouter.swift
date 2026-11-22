import Foundation
import TobyAI
import TobyCore

/// `FlowEventSource` over the app's `NativeAutomationEventSource` (in process).
struct AppFlowEventSource: FlowEventSource {
	static func json(_ value: [String: Any]) -> JSONValue {
		(try? JSONSerialization.data(withJSONObject: value)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? [:]
	}

	@MainActor static func call(_ method: String, _ path: String, _ body: JSONValue?) throws -> JSONValue {
		let response = json(NativeAutomationEventSource.shared.handle(method: method, path: "/api/native/flows/triggers/\(path)", body: body.map { Data($0.jsonString().utf8) }))
		guard response["ok"] == true else { throw TobyClientError.serverError(response["error"]?.stringValue ?? "macOS events unavailable") }
		return response["data"] ?? [:]
	}

	func subscribe(owner: String, types: [String], watches: [JSONValue]) async throws -> JSONValue {
		let body: JSONValue = ["owner": .string(owner), "types": .array(types.map(JSONValue.string)), "watches": .array(watches)]
		return try await MainActor.run { try Self.call("PUT", "subscriptions", body) }
	}

	func events(session: String, after: Int, limit: Int) async throws -> JSONValue {
		let query = "events?sessionId=\(session.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? session)&after=\(after)&limit=\(limit)"
		return try await MainActor.run { try Self.call("GET", query, nil) }
	}

	func notifyCompletion(flowID: String, runID: String?, name: String, success: Bool) async {
		guard let runID else { return }
		_ = await AppNativeBridge().call("flows/triggers/completion-notification", ["flowId": .string(flowID), "runId": .string(runID), "name": .string(name), "status": .string(success ? "success" : "error")])
	}
}

/// In-process `/api/flows*` (native mode); shapes match the daemon.
struct NativeFlowsRouter: Sendable {
	let flows: FlowService

	private func run(_ body: () async throws -> JSONValue) async throws -> Data {
		do {
			return Data(try await body().jsonString().utf8)
		} catch let error as TodoError {
			throw TobyClientError.serverError(error.message)
		} catch let error as FlowValidationError {
			throw TobyClientError.serverError(error.issues.joined(separator: "; "))
		}
	}

	func list() async throws -> Data { try await run { try await flows.list() } }
	func catalog() async throws -> Data { try await run { await flows.catalog() } }
	func detail(_ id: String) async throws -> Data { try await run { guard let value = try await flows.detail(id) else { throw TodoError("not_found", "Flow not found", status: 404) }; return value } }
	func save(_ body: Data, id: String?) async throws -> Data { try await run { try await flows.save(try JSONDecoder().decode(JSONValue.self, from: body), id: id) } }
	func delete(_ id: String) async throws { _ = try await run { try await flows.delete(id); return ["ok": true] } }
	func runNow(_ id: String, source: String, triggerID: String?) async throws -> Data { try await run { try await flows.runNow(id, source: source, triggerID: triggerID).json } }
	func runs(flowName: String?, limit: Int, offset: Int) async throws -> Data { try await run { try await flows.runs(flowName: flowName, limit: limit, offset: offset) } }
	func runDetail(_ id: String) async throws -> Data { try await run { guard let value = try await flows.runDetail(id) else { throw TodoError("not_found", "Flow run not found", status: 404) }; return value } }
	func parseCron(_ input: String) async throws -> String {
		do { return try await flows.parseCron(input) } catch let error as TodoError { throw TobyClientError.serverError(error.message) }
	}
}
