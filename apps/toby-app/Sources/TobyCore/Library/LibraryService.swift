import CryptoKit
import Foundation
import GRDB
import PDFKit
import TobyAI

/// Describes library files for search (AI summary/caption). Injectable for tests.
public protocol LibrarySummarizer: Sendable {
	func summarize(filename: String, mimeType: String, extractedText: String?, bytes: Data) async throws -> String
}

/// OpenRouter-backed summarizer (port of `library/summarize.ts`).
public struct AILibrarySummarizer: LibrarySummarizer {
	let model: LanguageModel
	static let documentPrompt = """
	You summarize a file for a personal knowledge library.
	Write 2-4 sentences that describe what the document is, who or what it is about, and the most useful facts someone would search for later.
	Do not mention these instructions. Output only the summary.
	"""
	static let imagePrompt = """
	You caption an image for a personal knowledge library.
	Write 1-3 sentences describing the visible subject, any readable text, and details that would help find this image later.
	Do not mention these instructions. Output only the caption.
	"""

	public init(model: LanguageModel) {
		self.model = model
	}

	public func summarize(filename: String, mimeType: String, extractedText: String?, bytes: Data) async throws -> String {
		if LibraryMedia.isImage(mimeType) {
			let fallback = LibraryMedia.describeImageFallback(filename: filename, mimeType: mimeType, bytes: bytes)
			do {
				let result = try await generateText(TextRequest(
					model: model,
					instructions: Self.imagePrompt,
					messages: [.user([.text("Filename: \(filename)\nMIME type: \(mimeType)"), .image(url: "data:\(mimeType);base64,\(bytes.base64EncodedString())")])],
					maxOutputTokens: 400,
				))
				let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
				return text.isEmpty ? fallback : text
			} catch AIError.insufficientCredits(let message) {
				throw AIError.insufficientCredits(message: message)
			} catch {
				return fallback
			}
		}
		let excerpt = String((extractedText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(12_000))
		guard !excerpt.isEmpty else { return "Document file \(filename) (\(mimeType))." }
		do {
			let result = try await generateText(TextRequest(
				model: model,
				instructions: Self.documentPrompt,
				messages: [.user("Filename: \(filename)\nMIME type: \(mimeType)\n\nContent:\n\(excerpt)")],
				maxOutputTokens: 400,
			))
			let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
			return text.isEmpty ? "Document file \(filename) (\(mimeType))." : text
		} catch AIError.insufficientCredits(let message) {
			throw AIError.insufficientCredits(message: message)
		} catch {
			return String(excerpt.prefix(400))
		}
	}
}

/// Media type rules (port of `library/media.ts`).
public enum LibraryMedia {
	public static let maxBytes = 20 * 1024 * 1024
	static let sidecar = "extracted.txt"
	static let embedExcerptChars = 8000
	static let textTypes: Set<String> = ["text/plain", "text/markdown"]
	static let imageTypes: Set<String> = ["image/png", "image/jpeg", "image/webp", "image/gif"]
	static let pdfType = "application/pdf"
	static var accepted: Set<String> { textTypes.union(imageTypes).union([pdfType]) }
	static let extensions: [String: String] = [
		"txt": "text/plain", "text": "text/plain", "md": "text/markdown", "markdown": "text/markdown", "pdf": "application/pdf",
		"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif",
	]
	static let catalogTextExtensions: Set<String> = [
		"json", "yaml", "yml", "csv", "tsv", "log", "xml", "html", "htm", "rst", "css", "js", "ts", "tsx", "jsx", "py", "swift",
		"rb", "go", "rs", "toml", "ini", "sh", "rtf",
	]
	static let catalogTextTypes: Set<String> = [
		"application/json", "application/xml", "text/xml", "text/csv", "text/html", "text/css", "text/javascript",
		"application/javascript", "application/typescript", "application/rtf", "text/yaml", "application/yaml", "application/x-yaml",
	]

	static func fileExtension(_ filename: String) -> String { (filename as NSString).pathExtension.lowercased() }

	public static func detect(filename: String, mediaType: String?) -> String? {
		if let explicit = mediaType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !explicit.isEmpty {
			if explicit == "text/x-markdown" { return "text/markdown" }
			if explicit == "image/jpg" { return "image/jpeg" }
			if accepted.contains(explicit) { return explicit }
			if explicit.hasPrefix("text/") { return "text/plain" }
		}
		return extensions[fileExtension(filename)]
	}

	public static func isImage(_ type: String) -> Bool { imageTypes.contains(type.lowercased()) }
	static func isText(_ type: String) -> Bool { textTypes.contains(type.lowercased()) }
	static func isPDF(_ type: String) -> Bool { type.lowercased() == pdfType }

	/// How a chat attachment or project file is stored: indexable (summarized) or opaque.
	static func catalogStorage(filename: String, mediaType: String?) -> (mimeType: String, summarize: Bool) {
		if let detected = detect(filename: filename, mediaType: mediaType), accepted.contains(detected) { return (detected, true) }
		let explicit = mediaType?.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
		if explicit.hasPrefix("text/") || catalogTextTypes.contains(explicit) || catalogTextExtensions.contains(fileExtension(filename)) {
			return ("text/plain", true)
		}
		return (explicit.isEmpty ? "application/octet-stream" : explicit, false)
	}

	public static func title(fromFilename filename: String) -> String {
		let base = ((filename as NSString).lastPathComponent as NSString).deletingPathExtension.trimmingCharacters(in: .whitespacesAndNewlines)
		let cleaned = base.replacingOccurrences(of: "[_-]+", with: " ", options: .regularExpression)
			.split(whereSeparator: \.isWhitespace).joined(separator: " ")
		return cleaned.isEmpty ? filename : cleaned
	}

	public static func sanitize(_ filename: String) -> String {
		let base = (filename as NSString).lastPathComponent.replacingOccurrences(of: "\u{0}", with: "")
		let trimmed = base.replacingOccurrences(of: "[<>:\"/\\\\|?*]", with: "_", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.isEmpty || trimmed == "." || trimmed == ".." { return "file" }
		if trimmed.lowercased() == sidecar { return "file-\(trimmed)" }
		return String(trimmed.prefix(180))
	}

	static func describeImageFallback(filename: String, mimeType: String, bytes: Data) -> String {
		var dims = ""
		let magic: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
		if bytes.count >= 24, Array(bytes.prefix(8)) == magic {
			let width = bytes[16 ..< 20].reduce(0) { $0 << 8 | UInt32($1) }
			let height = bytes[20 ..< 24].reduce(0) { $0 << 8 | UInt32($1) }
			dims = " \(width)×\(height)"
		}
		return "Image file \(filename) (\(mimeType)\(dims))."
	}

	/// Extract searchable text: PDFKit for PDFs, UTF-8 for text, none for images.
	static func extractText(bytes: Data, mimeType: String) -> (text: String?, error: String?) {
		if isImage(mimeType) { return (nil, nil) }
		if isPDF(mimeType) {
			guard let document = PDFDocument(data: bytes) else { return (nil, "Could not read the PDF.") }
			return (document.string ?? "", nil)
		}
		if isText(mimeType) {
			guard let text = String(data: bytes, encoding: .utf8), !text.contains("\u{0}") else { return (nil, "File is not valid UTF-8 text.") }
			return (text, nil)
		}
		return (nil, "Unsupported library media type: \(mimeType)")
	}
}

/// The document library (port of `library/library-service.ts`, store,
/// embeddings, and catalog sync). Files live in `<tobyDir>/library/<id>/`.
public final class LibraryService: Sendable {
	public static let acceptedMessage = "Library accepts text, Markdown, PDF, and images (PNG, JPEG, WebP, GIF)."
	let writer: any DatabaseWriter
	let root: URL
	let summarizer: @Sendable () -> (any LibrarySummarizer)?
	let embedder: @Sendable () -> (any TextEmbedder)?
	let indexQueue = IndexQueue(concurrency: 2)

	public init(
		writer: any DatabaseWriter,
		libraryDirectory: URL,
		summarizer: @escaping @Sendable () -> (any LibrarySummarizer)? = { nil },
		embedder: @escaping @Sendable () -> (any TextEmbedder)? = { nil },
	) {
		self.writer = writer
		root = libraryDirectory
		self.summarizer = summarizer
		self.embedder = embedder
	}

	public func isBacked(by writer: any DatabaseWriter) -> Bool { (self.writer as AnyObject) === (writer as AnyObject) }

	static func now() -> String { TodoRecurrence.isoString(Date()) }
	static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

	// MARK: Rows

	static let itemSelect = """
	SELECT i.*, e.model AS embedding_model FROM library_items i LEFT JOIN library_embeddings e ON e.item_id = i.id
	"""

	struct Item: Sendable {
		var json: [String: JSONValue]
		var id: String { json["id"]?.stringValue ?? "" }
		var relativePath: String { json["relativePath"]?.stringValue ?? "" }
		var mimeType: String { json["mimeType"]?.stringValue ?? "" }
		var title: String { json["title"]?.stringValue ?? "" }
		var description: String { json["description"]?.stringValue ?? "" }
		var filename: String { json["originalFilename"]?.stringValue ?? "" }
		var status: String { json["status"]?.stringValue ?? "" }
		var updatedAt: String { json["updatedAt"]?.stringValue ?? "" }
	}

	static func item(_ row: Row) -> Item {
		var object: [String: JSONValue] = [
			"id": .string(row["id"]), "title": .string(row["title"]), "originalFilename": .string(row["original_filename"]),
			"relativePath": .string(row["relative_path"]), "mimeType": .string(row["mime_type"]),
			"byteSize": .number(Double(row["byte_size"] as Int)), "contentHash": .string(row["content_hash"]),
			"description": .string(row["description"]), "status": .string(row["status"]), "source": .string(row["source"]),
			"createdAt": .string(row["created_at"]), "updatedAt": .string(row["updated_at"]),
		]
		if let error: String = row["error"] { object["error"] = .string(error) }
		if let model: String = row["embedding_model"] { object["embeddingModel"] = .string(model) }
		return Item(json: object)
	}

	func item(_ db: Database, id: String) throws -> Item? {
		try Row.fetchOne(db, sql: "\(Self.itemSelect) WHERE i.id = ?", arguments: [id]).map(Self.item)
	}

	/// Attach `references` (oldest first) to items.
	func withReferences(_ db: Database, _ items: [Item]) throws -> [JSONValue] {
		guard !items.isEmpty else { return [] }
		var grouped: [String: [JSONValue]] = [:]
		for start in stride(from: 0, to: items.count, by: 100) {
			let chunk = items[start ..< min(start + 100, items.count)].map(\.id)
			let marks = Array(repeating: "?", count: chunk.count).joined(separator: ",")
			for row in try Row.fetchAll(db, sql: "SELECT * FROM library_references WHERE item_id IN (\(marks)) ORDER BY created_at ASC", arguments: StatementArguments(chunk)) {
				let reference: JSONValue = [
					"id": .string(row["id"]), "itemId": .string(row["item_id"]), "kind": .string(row["kind"]), "label": .string(row["label"]),
					"detail": (row["detail"] as String?).map(JSONValue.string) ?? .null,
					"sessionId": (row["session_id"] as String?).map(JSONValue.string) ?? .null,
					"projectId": (row["project_id"] as String?).map(JSONValue.string) ?? .null,
					"createdAt": .string(row["created_at"]),
				]
				grouped[row["item_id"], default: []].append(reference)
			}
		}
		return items.map { item in
			var object = item.json
			object["references"] = .array(grouped[item.id] ?? [])
			return .object(object)
		}
	}

	func originClause(_ origin: String?) -> String {
		origin == nil ? "" : "WHERE EXISTS (SELECT 1 FROM library_references r WHERE r.item_id = i.id AND r.kind = ?)"
	}

	// MARK: Reads

	public func list(limit: Int = 50, offset: Int = 0, origin: String? = nil) throws -> (items: [JSONValue], total: Int) {
		try writer.read { db in
			var arguments: [any DatabaseValueConvertible] = []
			if let origin { arguments.append(origin) }
			let total = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM library_items i \(self.originClause(origin))", arguments: StatementArguments(arguments)) ?? 0
			arguments += [max(1, min(500, limit)), max(0, offset)]
			let rows = try Row.fetchAll(db, sql: "\(Self.itemSelect) \(self.originClause(origin)) ORDER BY i.updated_at DESC LIMIT ? OFFSET ?", arguments: StatementArguments(arguments)).map(Self.item)
			return (try self.withReferences(db, rows), total)
		}
	}

	public func get(_ id: String) throws -> JSONValue? {
		try writer.read { db in try self.item(db, id: id).map { try self.withReferences(db, [$0])[0] } }
	}

	func extractedText(_ id: String) -> String? {
		try? String(contentsOf: root.appending(path: "\(id)/\(LibraryMedia.sidecar)"), encoding: .utf8)
	}

	/// Keyword (metadata + extracted text) and semantic search; optional origin filter.
	public func search(_ query: String, origin: String? = nil) async throws -> [JSONValue] {
		let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return [] }
		let keywords = MemoryText.keywords(trimmed)
		var byID: [String: Item] = [:]
		let keywordItems = try await writer.read { db -> [Item] in
			if keywords.isEmpty {
				let pattern = "%\(MemoryText.escapeLike(trimmed))%"
				return try Row.fetchAll(db, sql: "\(Self.itemSelect) WHERE i.title LIKE ? ESCAPE '!' OR i.description LIKE ? ESCAPE '!' OR i.original_filename LIKE ? ESCAPE '!' ORDER BY i.updated_at DESC", arguments: [pattern, pattern, pattern]).map(Self.item)
			}
			let clause = Array(repeating: "(i.title LIKE ? ESCAPE '!' OR i.description LIKE ? ESCAPE '!' OR i.original_filename LIKE ? ESCAPE '!')", count: keywords.count).joined(separator: " OR ")
			let arguments = keywords.flatMap { keyword -> [any DatabaseValueConvertible] in
				let pattern = "%\(MemoryText.escapeLike(keyword))%"
				return [pattern, pattern, pattern]
			}
			let metadata = try Row.fetchAll(db, sql: "\(Self.itemSelect) WHERE \(clause) ORDER BY i.updated_at DESC", arguments: StatementArguments(arguments)).map(Self.item)
			let recent = try Row.fetchAll(db, sql: "\(Self.itemSelect) ORDER BY i.updated_at DESC LIMIT 500").map(Self.item)
			return metadata + recent.filter { item in
				let text = self.extractedText(item.id)?.lowercased() ?? ""
				return !text.isEmpty && keywords.contains { text.contains($0) }
			}
		}
		for item in keywordItems { byID[item.id] = item }
		let semantic = await semanticHits(trimmed)
		let known = Set(byID.keys)
		let extra = try await writer.read { db in
			try semantic.keys.filter { !known.contains($0) }.compactMap { try self.item(db, id: $0) }
		}
		for item in extra { byID[item.id] = item }
		func haystack(_ item: Item) -> String {
			"\(item.title) \(item.description) \(item.filename) \(extractedText(item.id) ?? "")".lowercased()
		}
		func score(_ item: Item) -> Double {
			let hay = haystack(item)
			var score: Double = item.status == "ready" ? 1 : 0
			if hay.contains(trimmed.lowercased()) { score += 10 }
			for keyword in keywords where hay.contains(keyword) { score += 2 }
			return score
		}
		let ranked = byID.values.sorted { a, b in
			let sa = semantic[a.id] ?? 0, sb = semantic[b.id] ?? 0
			if sa != sb { return sa > sb }
			let ka = score(a), kb = score(b)
			if ka != kb { return ka > kb }
			return a.updatedAt > b.updatedAt
		}
		let withRefs = try await writer.read { db in try self.withReferences(db, ranked) }
		guard let origin else { return withRefs }
		return withRefs.filter { ($0["references"]?.arrayValue ?? []).contains { $0["kind"]?.stringValue == origin } }
	}

	// MARK: Add / update / remove

	public struct AddResult: Sendable {
		public var item: JSONValue
		public var duplicate: Bool
	}

	public func add(filename rawName: String, bytes: Data, mediaType: String? = nil, source: String = "ui", reference: JSONValue? = nil, waitForIndex: Bool = false) async throws -> AddResult {
		let filename = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !filename.isEmpty else { throw TodoError.invalid("Filename is required.") }
		guard let mime = LibraryMedia.detect(filename: filename, mediaType: mediaType), LibraryMedia.accepted.contains(mime) else {
			throw TodoError.invalid(Self.acceptedMessage)
		}
		try Self.checkSize(bytes)
		return try await store(filename: filename, bytes: bytes, mimeType: mime, source: source, reference: reference, opaque: false, waitForIndex: waitForIndex)
	}

	/// Catalog a chat attachment or project file (indexable or opaque).
	@discardableResult
	public func catalog(filename rawName: String, bytes: Data, mediaType: String?, source: String, reference: JSONValue) async throws -> AddResult? {
		let filename = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !filename.isEmpty, !bytes.isEmpty, bytes.count <= LibraryMedia.maxBytes else { return nil }
		let storage = LibraryMedia.catalogStorage(filename: filename, mediaType: mediaType)
		return try await store(filename: filename, bytes: bytes, mimeType: storage.mimeType, source: source, reference: reference, opaque: !storage.summarize, waitForIndex: false)
	}

	static func checkSize(_ bytes: Data) throws {
		guard !bytes.isEmpty else { throw TodoError.invalid("File is empty.") }
		guard bytes.count <= LibraryMedia.maxBytes else {
			throw TodoError.invalid("File is too large (\(Int((Double(bytes.count) / 1024).rounded()))KB). Maximum is \(LibraryMedia.maxBytes / 1024)KB.")
		}
	}

	func insertReference(_ db: Database, itemID: String, _ reference: JSONValue?) throws {
		let reference = reference ?? ["kind": "manual", "label": "Library"]
		func optional(_ key: String) -> String? { reference[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
		try db.execute(sql: """
		INSERT OR IGNORE INTO library_references (id, item_id, kind, session_id, project_id, label, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		""", arguments: [UUID().uuidString.lowercased(), itemID, reference["kind"]?.stringValue ?? "manual", optional("sessionId"), optional("projectId"),
		                 optional("label") ?? "Library", optional("detail"), Self.now()])
	}

	func store(filename: String, bytes: Data, mimeType: String, source: String, reference: JSONValue?, opaque: Bool, waitForIndex: Bool) async throws -> AddResult {
		let hash = Self.hash(bytes)
		if let existing = try await writer.write({ db -> JSONValue? in
			guard let existing = try Row.fetchOne(db, sql: "\(Self.itemSelect) WHERE i.content_hash = ? LIMIT 1", arguments: [hash]).map(Self.item) else { return nil }
			try self.insertReference(db, itemID: existing.id, reference)
			return try self.withReferences(db, [try self.item(db, id: existing.id) ?? existing])[0]
		}) {
			return AddResult(item: existing, duplicate: true)
		}
		let id = UUID().uuidString.lowercased()
		let safe = LibraryMedia.sanitize(filename)
		let folder = root.appending(path: id, directoryHint: .isDirectory)
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
		try bytes.write(to: folder.appending(path: safe))
		try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: folder.appending(path: safe).path)
		let ts = Self.now()
		try await writer.write { db in
			try db.execute(sql: """
			INSERT INTO library_items (id, title, original_filename, relative_path, mime_type, byte_size, content_hash, description, status, error, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
			""", arguments: [id, LibraryMedia.title(fromFilename: filename), filename, "\(id)/\(safe)", mimeType, bytes.count, hash,
			                 opaque ? "Original \(mimeType) file saved for reference." : "", opaque ? "ready" : "pending", source, ts, ts])
			try self.insertReference(db, itemID: id, reference)
		}
		if opaque {
			await indexQueue.enqueue { [self] in await self.storeEmbedding(id) }
		} else if waitForIndex {
			_ = try await index(id)
		} else {
			await indexQueue.enqueue { [self] in _ = try? await self.index(id) }
		}
		return AddResult(item: try get(id) ?? .null, duplicate: false)
	}

	/// Extract, summarize, and embed one item.
	@discardableResult
	public func index(_ id: String) async throws -> JSONValue {
		guard let item = try await writer.read({ db in try self.item(db, id: id) }) else {
			throw TodoError("not_found", "Library item not found.", status: 404)
		}
		do {
			let bytes = try Data(contentsOf: root.appending(path: item.relativePath))
			let extracted = LibraryMedia.extractText(bytes: bytes, mimeType: item.mimeType)
			if let error = extracted.error, extracted.text == nil {
				try await update(id, ["status": .string("failed"), "error": .string(error)])
				return try get(id) ?? .null
			}
			if let text = extracted.text {
				let sidecar = root.appending(path: "\(id)/\(LibraryMedia.sidecar)")
				try text.write(to: sidecar, atomically: true, encoding: .utf8)
			}
			let description = try await summarizer()?.summarize(filename: item.filename, mimeType: item.mimeType, extractedText: extracted.text, bytes: bytes)
				?? (LibraryMedia.isImage(item.mimeType)
					? LibraryMedia.describeImageFallback(filename: item.filename, mimeType: item.mimeType, bytes: bytes)
					: String((extracted.text ?? "Document file \(item.filename) (\(item.mimeType)).").prefix(400)))
			try await update(id, ["description": .string(description), "status": "ready", "error": .null])
			await storeEmbedding(id)
			return try get(id) ?? .null
		} catch let error as AIError {
			try await update(id, ["status": "failed", "error": .string(error.localizedDescription)])
			if case .insufficientCredits = error { throw error }
			return try get(id) ?? .null
		} catch {
			try await update(id, ["status": "failed", "error": .string(error.localizedDescription)])
			return try get(id) ?? .null
		}
	}

	static let columns: [String: String] = [
		"title": "title", "originalFilename": "original_filename", "relativePath": "relative_path", "mimeType": "mime_type",
		"byteSize": "byte_size", "contentHash": "content_hash", "description": "description", "status": "status", "error": "error",
	]

	func update(_ id: String, _ patch: [String: JSONValue]) async throws {
		let now = Self.now()
		try await writer.write { db in
			var sets = ["updated_at = ?"]
			var arguments: [(any DatabaseValueConvertible)?] = [now]
			for (key, value) in patch.sorted(by: { $0.key < $1.key }) {
				guard let column = Self.columns[key] else { continue }
				sets.append("\(column) = ?")
				switch value {
				case let .string(text): arguments.append(text)
				case let .number(number): arguments.append(Int(number))
				default: arguments.append(nil)
				}
			}
			arguments.append(id)
			try db.execute(sql: "UPDATE library_items SET \(sets.joined(separator: ", ")) WHERE id = ?", arguments: StatementArguments(arguments))
		}
	}

	/// Edit title/description, or replace the file (re-indexes).
	public func update(_ id: String, title: String? = nil, description: String? = nil, filename: String? = nil, bytes: Data? = nil, mediaType: String? = nil) async throws -> JSONValue {
		guard let existing = try await writer.read({ db in try self.item(db, id: id) }) else {
			throw TodoError("not_found", "Library item not found.", status: 404)
		}
		if let bytes {
			let name = (filename ?? existing.filename).trimmingCharacters(in: .whitespacesAndNewlines)
			guard let mime = LibraryMedia.detect(filename: name, mediaType: mediaType), LibraryMedia.accepted.contains(mime) else {
				throw TodoError.invalid(Self.acceptedMessage)
			}
			try Self.checkSize(bytes)
			let hash = Self.hash(bytes)
			if let duplicate = try await writer.read({ db in try Row.fetchOne(db, sql: "\(Self.itemSelect) WHERE i.content_hash = ? LIMIT 1", arguments: [hash]).map(Self.item) }), duplicate.id != id {
				throw TodoError.invalid("That file is already in the library as \"\(duplicate.title)\".")
			}
			let safe = LibraryMedia.sanitize(name)
			let previous = root.appending(path: existing.relativePath)
			let next = root.appending(path: "\(id)/\(safe)")
			try FileManager.default.createDirectory(at: next.deletingLastPathComponent(), withIntermediateDirectories: true)
			if previous.path != next.path { try? FileManager.default.removeItem(at: previous) }
			try bytes.write(to: next)
			var patch: [String: JSONValue] = [
				"title": .string(title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? LibraryMedia.title(fromFilename: name)),
				"originalFilename": .string(name), "relativePath": .string("\(id)/\(safe)"), "mimeType": .string(mime),
				"byteSize": .number(Double(bytes.count)), "contentHash": .string(hash), "status": "pending", "error": .null,
			]
			if let description { patch["description"] = .string(description) }
			try await update(id, patch)
			return try await index(id)
		}
		var patch: [String: JSONValue] = [:]
		if let title = title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty { patch["title"] = .string(title) }
		if let description { patch["description"] = .string(description) }
		try await update(id, patch)
		if !patch.isEmpty, existing.status == "ready" { await storeEmbedding(id) }
		return try get(id) ?? .null
	}

	@discardableResult
	public func remove(_ id: String) throws -> Bool {
		guard try get(id) != nil else { return false }
		try? FileManager.default.removeItem(at: root.appending(path: id, directoryHint: .isDirectory))
		return try writer.write { db in
			try db.execute(sql: "DELETE FROM library_embeddings WHERE item_id = ?", arguments: [id])
			try db.execute(sql: "DELETE FROM library_items WHERE id = ?", arguments: [id])
			return db.changesCount > 0
		}
	}

	/// The item's bytes and extracted text (chat tools).
	public func open(_ id: String) throws -> (item: JSONValue, bytes: Data, extractedText: String?) {
		guard let item = try get(id), let relative = item["relativePath"]?.stringValue else {
			throw TodoError("not_found", "Library item not found.", status: 404)
		}
		guard let bytes = try? Data(contentsOf: root.appending(path: relative)) else {
			throw TodoError("not_found", "Library file is missing from disk.", status: 404)
		}
		return (item, bytes, extractedText(id))
	}

	public func waitForIndexing() async { await indexQueue.drain() }

	// MARK: Embeddings

	func embedText(_ item: Item) -> String {
		var parts = [item.title.trimmingCharacters(in: .whitespacesAndNewlines)]
		if !item.filename.trimmingCharacters(in: .whitespaces).isEmpty { parts.append(item.filename.trimmingCharacters(in: .whitespaces)) }
		if !item.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { parts.append(item.description.trimmingCharacters(in: .whitespacesAndNewlines)) }
		if let excerpt = extractedText(item.id)?.trimmingCharacters(in: .whitespacesAndNewlines).prefix(LibraryMedia.embedExcerptChars), !excerpt.isEmpty {
			parts.append(String(excerpt))
		}
		return parts.filter { !$0.isEmpty }.joined(separator: "\n")
	}

	func storeEmbedding(_ id: String) async {
		guard let embedder = embedder(),
		      let item = try? await writer.read({ db in try self.item(db, id: id) }),
		      let vector = try? await embedder.embed([embedText(item)]).first else { return }
		try? await writer.write { db in
			try db.execute(sql: """
			INSERT INTO library_embeddings (item_id, embedding_blob, model, created_at) VALUES (?, ?, ?, ?)
			ON CONFLICT(item_id) DO UPDATE SET embedding_blob = excluded.embedding_blob, model = excluded.model, created_at = excluded.created_at
			""", arguments: [id, VectorMath.blob(vector), embedder.modelID, Self.now()])
		}
	}

	public func backfillEmbeddings() async {
		guard let embedder = embedder(),
		      let ids = try? await writer.read({ db in
		      	try String.fetchAll(db, sql: "SELECT i.id FROM library_items i LEFT JOIN library_embeddings e ON e.item_id = i.id WHERE i.status = 'ready' AND (e.item_id IS NULL OR e.model != ?)", arguments: [embedder.modelID])
		      }) else { return }
		for id in ids { await storeEmbedding(id) }
	}

	func semanticHits(_ query: String) async -> [String: Float] {
		guard let embedder = embedder() else { return [:] }
		await backfillEmbeddings()
		guard let vector = try? await embedder.embed([query]).first,
		      let candidates = try? await writer.read({ db in
		      	try Row.fetchAll(db, sql: "SELECT item_id, embedding_blob FROM library_embeddings WHERE model = ?", arguments: [embedder.modelID])
		      		.map { (id: $0["item_id"] as String, vector: VectorMath.vector(fromBlob: $0["embedding_blob"] as Data)) }
		      }) else { return [:] }
		let hits = VectorMath.topK(query: vector, candidates: candidates, k: 25, minScore: 0.35)
		return Dictionary(hits.map { ($0.id, $0.score) }, uniquingKeysWith: { a, _ in a })
	}

	// MARK: Catalog sync (project files + chat attachments)

	public static func isCatalogedProjectPath(_ relativePath: String) -> Bool {
		let normalized = relativePath.hasPrefix("./") ? String(relativePath.dropFirst(2)) : relativePath
		if normalized.isEmpty || normalized == "AGENTS.md" { return false }
		if normalized.hasPrefix(".agent/") || normalized.hasPrefix("skills/") { return false }
		return !normalized.split(separator: "/").contains("node_modules")
	}

	func seen(_ key: String) async -> String? {
		try? await writer.read { db in try String.fetchOne(db, sql: "SELECT fingerprint FROM library_catalog_seen WHERE origin_key = ?", arguments: [key]) }
	}

	func markSeen(_ key: String, _ fingerprint: String) async {
		try? await writer.write { db in
			try db.execute(sql: """
			INSERT INTO library_catalog_seen (origin_key, fingerprint, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(origin_key) DO UPDATE SET fingerprint = excluded.fingerprint, updated_at = excluded.updated_at
			""", arguments: [key, fingerprint, Self.now()])
		}
	}

	/// Catalog new/changed project files and chat attachments (idempotent).
	public func syncCatalog(projects: ProjectService) async {
		for project in (try? projects.list()) ?? [] {
			let folder = URL(fileURLWithPath: project.folderPath)
			for relative in Self.listFiles(folder) where Self.isCatalogedProjectPath(relative) {
				let url = folder.appending(path: relative)
				guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
				      attributes[.type] as? FileAttributeType == .typeRegular,
				      let size = (attributes[.size] as? NSNumber)?.intValue, size > 0,
				      let modified = attributes[.modificationDate] as? Date else { continue }
				let key = "project:\(project.id):\(relative)"
				let fingerprint = "\(size):\(Int((modified.timeIntervalSince1970 * 1000).rounded()))"
				guard await seen(key) != fingerprint, let bytes = try? Data(contentsOf: url) else { continue }
				let reference: JSONValue = ["kind": "project", "projectId": .string(project.id), "label": .string(project.name.nilIfEmpty ?? "Project"), "detail": .string(relative)]
				if (try? await catalog(filename: url.lastPathComponent, bytes: bytes, mediaType: nil, source: "project", reference: reference)) != nil {
					await markSeen(key, fingerprint)
				}
			}
		}
		let rows = (try? await writer.read { db in
			try Row.fetchAll(db, sql: """
			SELECT t.session_id, t.idx, t.text, s.name FROM chat_session_transcript t JOIN chat_sessions s ON s.id = t.session_id
			WHERE t.kind = 'user' AND instr(t.text, '"attachments"') > 0
			""").map { (session: $0["session_id"] as String, idx: $0["idx"] as Int, text: $0["text"] as String, name: $0["name"] as String) }
		}) ?? []
		for row in rows {
			let key = "chat:\(row.session):\(row.idx)"
			let fingerprint = String(row.text.utf16.count)
			guard await seen(key) != fingerprint else { continue }
			let attachments = row.text.hasPrefix("{") ? ((try? JSONValue(parsing: row.text))?["attachments"]?.arrayValue ?? []) : []
			var saved = true
			for attachment in attachments {
				guard let filename = attachment["filename"]?.stringValue, !filename.trimmingCharacters(in: .whitespaces).isEmpty,
				      let mediaType = attachment["mediaType"]?.stringValue,
				      let base64 = attachment["dataBase64"]?.stringValue, let bytes = Data(base64Encoded: base64) else { continue }
				let reference: JSONValue = ["kind": "chat", "sessionId": .string(row.session), "label": .string(row.name.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? "Chat"), "detail": .string(filename)]
				do { try await catalog(filename: filename, bytes: bytes, mediaType: mediaType, source: "chat", reference: reference) } catch { saved = false }
			}
			if saved { await markSeen(key, fingerprint) }
		}
	}

	/// Relative file paths under `folder` (skips hidden except `.agent`, symlinks; depth ≤ 8).
	static func listFiles(_ folder: URL) -> [String] {
		var files: [String] = []
		func walk(_ directory: URL, depth: Int) {
			guard depth <= 8, let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
			for name in names where !name.hasPrefix(".") || name == ".agent" {
				let url = directory.appending(path: name)
				guard let type = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.type] as? FileAttributeType else { continue }
				if type == .typeDirectory { walk(url, depth: depth + 1) } else if type == .typeRegular {
					files.append(String(url.path.dropFirst(folder.path.count + 1)))
				}
			}
		}
		walk(folder, depth: 0)
		return files.sorted()
	}
}

/// Bounded-concurrency background work queue.
actor IndexQueue {
	let concurrency: Int
	var running = 0
	var pending: [@Sendable () async -> Void] = []
	var waiters: [CheckedContinuation<Void, Never>] = []

	init(concurrency: Int) {
		self.concurrency = concurrency
	}

	func enqueue(_ work: @escaping @Sendable () async -> Void) {
		pending.append(work)
		pump()
	}

	func pump() {
		while running < concurrency, !pending.isEmpty {
			let work = pending.removeFirst()
			running += 1
			Task {
				await work()
				self.finished()
			}
		}
		if running == 0, pending.isEmpty {
			let ready = waiters
			waiters.removeAll()
			ready.forEach { $0.resume() }
		}
	}

	func finished() {
		running -= 1
		pump()
	}

	func drain() async {
		if running == 0, pending.isEmpty { return }
		await withCheckedContinuation { waiters.append($0) }
	}
}
