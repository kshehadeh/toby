import Foundation
import TobyAI
import TobyCore

/// In-process `/api/library` (native mode), with the daemon's validation and shapes.
struct NativeLibraryRouter: Sendable {
	let library: LibraryService
	let projects: ProjectService

	func data(_ value: JSONValue) -> Data { Data(value.jsonString().utf8) }

	func mapped<T>(_ body: () async throws -> T) async throws -> T {
		do { return try await body() } catch let error as TodoError { throw TobyClientError.serverError(error.message) }
	}

	func list(limit: Int, offset: Int, query: String?, origin: String?, refresh: Bool) async throws -> Data {
		let origin = (origin == nil || origin == "all") ? nil : origin
		if let origin, !["manual", "chat", "project"].contains(origin) {
			throw TobyClientError.serverError("Query 'origin' must be all, manual, chat, or project.")
		}
		let library = library, projects = projects
		Task.detached(priority: .utility) { await library.syncCatalog(projects: projects) }
		let limit = max(1, min(500, limit)), offset = max(0, offset)
		if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			let all = try await self.library.search(query, origin: origin)
			let page = Array(all.dropFirst(offset).prefix(limit))
			return data(["items": .array(page), "limit": .number(Double(limit)), "offset": .number(Double(offset)), "total": .number(Double(all.count)), "hasMore": .bool(offset + page.count < all.count), "catalogSyncing": false])
		}
		let (items, total) = try self.library.list(limit: limit, offset: offset, origin: origin)
		return data(["items": .array(items), "limit": .number(Double(limit)), "offset": .number(Double(offset)), "total": .number(Double(total)), "hasMore": .bool(offset + items.count < total), "catalogSyncing": false])
	}

	func get(_ id: String) throws -> Data {
		guard let item = try library.get(id) else { throw TobyClientError.serverError("Library item not found") }
		return data(["item": item])
	}

	func create(_ body: Data) async throws -> Data {
		let input = try JSONDecoder().decode(JSONValue.self, from: body)
		let filename = input["filename"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		guard !filename.isEmpty else { throw TobyClientError.serverError("Body must include a non-empty 'filename' field") }
		guard let base64 = input["dataBase64"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !base64.isEmpty else {
			throw TobyClientError.serverError("Body must include a non-empty 'dataBase64' field")
		}
		guard let bytes = Data(base64Encoded: base64), !bytes.isEmpty else { throw TobyClientError.serverError("dataBase64 is not valid base64") }
		let result = try await mapped { try await library.add(filename: filename, bytes: bytes, mediaType: input["mediaType"]?.stringValue, source: "ui") }
		return data(["item": result.item, "duplicate": .bool(result.duplicate)])
	}

	func patch(_ id: String, _ body: Data) async throws -> Data {
		let input = try JSONDecoder().decode(JSONValue.self, from: body)
		let base64 = input["dataBase64"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
		let bytes = base64.flatMap { $0.isEmpty ? nil : Data(base64Encoded: $0) }
		if let base64, !base64.isEmpty, bytes == nil { throw TobyClientError.serverError("dataBase64 is not valid base64") }
		let title = input["title"]?.stringValue
		let description = input["description"]?.stringValue
		guard title != nil || description != nil || bytes != nil else {
			throw TobyClientError.serverError("Body must include at least one of title, description, or dataBase64")
		}
		let item = try await mapped {
			try await library.update(id, title: title, description: description, filename: input["filename"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), bytes: bytes, mediaType: input["mediaType"]?.stringValue)
		}
		return data(["item": item])
	}

	func delete(_ id: String) throws {
		guard try library.remove(id) else { throw TobyClientError.serverError("Library item not found") }
	}
}
