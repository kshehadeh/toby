import Foundation
import TobyAI
import TobyCore

/// In-process `/api/memories` and `/api/graph` (native mode). Validation and
/// response shapes match the daemon handlers.
struct NativeMemoryRouter: Sendable {
	let memory: MemoryService
	let graph: GraphService

	static let types = Set(MemoryText.types)
	static let sensitivities = Set(MemoryText.sensitivities)
	static let visibilities = Set(MemoryText.visibilities)

	func list(limit: Int, offset: Int, query: String?) async throws -> Data {
		let limit = max(1, min(500, limit))
		let offset = max(0, offset)
		if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			let all = try await memory.search(query)
			let page = Array(all.dropFirst(offset).prefix(limit))
			return encode(["memories": .array(page), "limit": .number(Double(limit)), "offset": .number(Double(offset)), "total": .number(Double(all.count)), "hasMore": .bool(offset + page.count < all.count)])
		}
		let (items, total) = try memory.list(limit: limit, offset: offset)
		return encode(["memories": .array(items), "limit": .number(Double(limit)), "offset": .number(Double(offset)), "total": .number(Double(total)), "hasMore": .bool(offset + items.count < total)])
	}

	func get(_ id: String) throws -> Data {
		guard let item = try memory.get(id) else { throw TobyClientError.serverError("Memory not found") }
		return encode(["memory": item])
	}

	func create(_ body: Data) async throws -> Data {
		let input = try JSONDecoder().decode(JSONValue.self, from: body)
		let value = input["value"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		guard !value.isEmpty else { throw TobyClientError.serverError("Body must include a non-empty 'value' field") }
		let type = try validated(input["type"]?.stringValue ?? "fact", in: Self.types, field: "type")
		let sensitivity = try validated(input["sensitivity"]?.stringValue ?? "normal", in: Self.sensitivities, field: "sensitivity")
		let visibility = try validated(input["visibility"]?.stringValue ?? "usable_by_ai", in: Self.visibilities, field: "visibility")
		let confidence = input["confidence"]?.doubleValue.map { min(1, max(0, $0)) } ?? 1
		let item = try await memory.createManual(.init(
			type: type,
			subject: input["subject"]?.stringValue,
			value: value,
			confidence: confidence,
			sensitivity: sensitivity,
			visibility: visibility,
			expiresAt: input["expiresAt"]?.stringValue,
		))
		return encode(["memory": item])
	}

	func patch(_ id: String, _ body: Data) async throws -> Data {
		let input = try JSONDecoder().decode(JSONValue.self, from: body)
		var patch = MemoryService.Patch()
		if let value = input["value"]?.stringValue {
			let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !trimmed.isEmpty else { throw TobyClientError.serverError("'value' must be non-empty") }
			patch.value = trimmed
		}
		if let subject = input["subject"]?.stringValue { patch.subject = subject.trimmingCharacters(in: .whitespacesAndNewlines) }
		if let type = input["type"]?.stringValue { patch.type = try validated(type, in: Self.types, field: "type") }
		if let sensitivity = input["sensitivity"]?.stringValue { patch.sensitivity = try validated(sensitivity, in: Self.sensitivities, field: "sensitivity") }
		if let visibility = input["visibility"]?.stringValue { patch.visibility = try validated(visibility, in: Self.visibilities, field: "visibility") }
		if let confidence = input["confidence"]?.doubleValue { patch.confidence = min(1, max(0, confidence)) }
		if let expires = input["expiresAt"] { patch.expiresAt = .some(expires.stringValue) }
		do {
			return encode(["memory": try await memory.update(id, patch)])
		} catch let error as TodoError {
			throw TobyClientError.serverError(error.message)
		}
	}

	func delete(_ id: String) throws {
		do { try memory.forget(id) } catch let error as TodoError { throw TobyClientError.serverError(error.message) }
	}

	private func validated(_ value: String, in allowed: Set<String>, field: String) throws -> String {
		guard allowed.contains(value) else {
			throw TobyClientError.serverError("Invalid '\(field)'. Must be one of: \(allowed.sorted().joined(separator: ", "))")
		}
		return value
	}

	func graphSnapshot(types: [String], limit: Int) throws -> Data {
		encode(try graph.snapshot(types: types.isEmpty ? nil : types, limit: limit))
	}

	private func encode(_ value: JSONValue) -> Data { Data(value.jsonString().utf8) }
}
