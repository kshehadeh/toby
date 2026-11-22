import Foundation
import GRDB
import TobyAI
import TobyStore

/// Produces embeddings for memory/graph/library text.
public protocol TextEmbedder: Sendable {
	var modelID: String { get }
	func embed(_ texts: [String]) async throws -> [[Float]]
}

extension EmbeddingModel: TextEmbedder {
	public var modelID: String { id }
	public func embed(_ texts: [String]) async throws -> [[Float]] {
		try await embedMany(texts).embeddings
	}
}

/// Long-term memory (port of `memory/memory-service.ts`, `memory-store.ts`,
/// `embeddings.ts`). Writes mirror into the knowledge graph in the same
/// transaction. JSON output matches the daemon's `/api/memories`.
public final class MemoryService: Sendable {
	public static let defaultUser = "default"
	static let nearExact: Float = 0.95
	static let nearDuplicate: Float = 0.88
	static let searchMinScore: Float = 0.35
	static let searchTopK = 25

	let writer: any DatabaseWriter
	/// Returns nil when no embedder is available (e.g. not signed in).
	let embedder: @Sendable () -> (any TextEmbedder)?

	public init(writer: any DatabaseWriter, embedder: @escaping @Sendable () -> (any TextEmbedder)? = { nil }) {
		self.writer = writer
		self.embedder = embedder
	}

	static func now() -> String { TodoRecurrence.isoString(Date()) }

	public func isBacked(by database: TobyDatabase) -> Bool {
		(writer as AnyObject) === (database.writer as AnyObject)
	}

	// MARK: Rows

	static let itemSelect = """
	SELECT i.id, i.user_id, i.type, i.subject, i.value, i.confidence, i.sensitivity, i.visibility, i.expires_at,
	       i.created_at, i.updated_at, e.model AS embedding_model
	FROM memory_items i LEFT JOIN memory_embeddings e ON e.memory_id = i.id
	"""

	static func record(_ db: Database, _ row: Row) throws -> MemoryRecord {
		let id: String = row["id"]
		return MemoryRecord(
			id: id,
			userID: row["user_id"],
			type: row["type"],
			subject: row["subject"],
			value: row["value"],
			confidence: row["confidence"],
			sensitivity: row["sensitivity"],
			visibility: row["visibility"],
			sourceIDs: try String.fetchAll(db, sql: "SELECT source_id FROM memory_item_sources WHERE memory_id = ?", arguments: [id]),
			createdAt: row["created_at"],
			updatedAt: row["updated_at"],
			expiresAt: row["expires_at"],
			embeddingModel: row["embedding_model"],
		)
	}

	public static func json(_ item: MemoryRecord) -> JSONValue {
		var object: [String: JSONValue] = [
			"id": .string(item.id), "userId": .string(item.userID), "type": .string(item.type), "value": .string(item.value),
			"confidence": .number(item.confidence), "sensitivity": .string(item.sensitivity), "visibility": .string(item.visibility),
			"sourceIds": .array(item.sourceIDs.map(JSONValue.string)), "createdAt": .string(item.createdAt), "updatedAt": .string(item.updatedAt),
		]
		if let subject = item.subject { object["subject"] = .string(subject) }
		if let expiresAt = item.expiresAt { object["expiresAt"] = .string(expiresAt) }
		if let model = item.embeddingModel { object["embeddingModel"] = .string(model) }
		return .object(object)
	}

	func item(_ db: Database, id: String, user: String = defaultUser) throws -> MemoryRecord? {
		try Row.fetchOne(db, sql: "\(Self.itemSelect) WHERE i.id = ? AND i.user_id = ?", arguments: [id, user]).map { try Self.record(db, $0) }
	}

	func items(_ db: Database, sql: String, arguments: StatementArguments) throws -> [MemoryRecord] {
		try Row.fetchAll(db, sql: sql, arguments: arguments).map { try Self.record(db, $0) }
	}

	func audit(_ db: Database, memoryID: String?, action: String, detail: JSONValue? = nil, user: String = defaultUser) throws {
		try db.execute(sql: "INSERT INTO memory_audit_log (id, user_id, memory_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", arguments: [
			UUID().uuidString.lowercased(), user, memoryID, action, detail?.jsonString(), Self.now(),
		])
	}

	func insertSource(_ db: Database, system: String, sourceID: String? = nil, url: String? = nil, observedAt: String = now(), excerpt: String? = nil, metadata: JSONValue? = nil, user: String = defaultUser) throws -> String {
		let id = UUID().uuidString.lowercased()
		try db.execute(sql: """
		INSERT INTO memory_sources (id, user_id, system, source_id, source_url, observed_at, excerpt, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		""", arguments: [id, user, system, sourceID, url, observedAt, excerpt, metadata?.jsonString()])
		return id
	}

	// MARK: Reads

	public func get(_ id: String) throws -> JSONValue? {
		try writer.read { db in try self.item(db, id: id).map(Self.json) }
	}

	public func list(limit: Int = 50, offset: Int = 0) throws -> (items: [JSONValue], total: Int) {
		try writer.read { db in
			let rows = try self.items(db, sql: "\(Self.itemSelect) WHERE i.user_id = ? ORDER BY i.updated_at DESC LIMIT ? OFFSET ?",
			                          arguments: [Self.defaultUser, max(1, min(500, limit)), max(0, offset)])
			let total = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM memory_items WHERE user_id = ?", arguments: [Self.defaultUser]) ?? 0
			return (rows.map(Self.json), total)
		}
	}

	/// Keyword search merged with semantic hits when an embedder is available.
	public func search(_ query: String) async throws -> [JSONValue] {
		let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return [] }
		let keywords = MemoryText.keywords(trimmed)
		var byID: [String: MemoryRecord] = [:]
		for item in try await writer.read({ db in try self.keywordMatches(db, query: trimmed, keywords: keywords) }) {
			byID[item.id] = item
		}
		let semantic = await semanticHits(trimmed)
		if !semantic.isEmpty {
			let known = Set(byID.keys)
			let extra = try await writer.read { db in
				try semantic.keys.filter { !known.contains($0) }.compactMap { try self.item(db, id: $0) }
			}
			for item in extra { byID[item.id] = item }
		}
		return MemoryText.rank(Array(byID.values), query: trimmed, keywords: keywords, semantic: semantic).map(Self.json)
	}

	func keywordMatches(_ db: Database, query: String, keywords: [String]) throws -> [MemoryRecord] {
		if keywords.isEmpty {
			let pattern = "%\(MemoryText.escapeLike(query))%"
			return try items(db, sql: """
			\(Self.itemSelect) WHERE i.user_id = ? AND (i.value LIKE ? ESCAPE '!' OR i.subject LIKE ? ESCAPE '!' OR i.type LIKE ? ESCAPE '!')
			ORDER BY i.updated_at DESC
			""", arguments: [Self.defaultUser, pattern, pattern, pattern])
		}
		let clause = Array(repeating: "(i.value LIKE ? ESCAPE '!' OR i.subject LIKE ? ESCAPE '!' OR i.type LIKE ? ESCAPE '!')", count: keywords.count).joined(separator: " OR ")
		var arguments: [any DatabaseValueConvertible] = [Self.defaultUser]
		for keyword in keywords {
			let pattern = "%\(MemoryText.escapeLike(keyword))%"
			arguments += [pattern, pattern, pattern]
		}
		return try items(db, sql: "\(Self.itemSelect) WHERE i.user_id = ? AND (\(clause)) ORDER BY i.updated_at DESC", arguments: StatementArguments(arguments))
	}

	/// Memories usable in the system prompt (usable_by_ai, not expired).
	public func usableForPrompt(limit: Int = 200) throws -> [MemoryRecord] {
		try writer.read { db in
			try self.items(db, sql: """
			\(Self.itemSelect) WHERE i.user_id = ? AND i.visibility = 'usable_by_ai' AND (i.expires_at IS NULL OR i.expires_at > ?)
			ORDER BY i.updated_at DESC LIMIT ?
			""", arguments: [Self.defaultUser, Self.now(), max(1, min(500, limit))])
		}
	}

	public func explain(_ id: String) throws -> JSONValue? {
		try writer.read { db in
			guard let item = try self.item(db, id: id) else { return nil }
			var sources: [JSONValue] = []
			for sourceID in item.sourceIDs {
				guard let row = try Row.fetchOne(db, sql: "SELECT * FROM memory_sources WHERE id = ?", arguments: [sourceID]) else { continue }
				var object: [String: JSONValue] = [
					"id": .string(row["id"]), "userId": .string(row["user_id"]), "system": .string(row["system"]),
					"observedAt": .string(row["observed_at"]),
				]
				if let value: String = row["source_id"] { object["sourceId"] = .string(value) }
				if let value: String = row["source_url"] { object["sourceUrl"] = .string(value) }
				if let value: String = row["excerpt"] { object["excerpt"] = .string(value) }
				if let value: String = row["metadata_json"], let parsed = try? JSONValue(parsing: value) { object["metadata"] = parsed }
				sources.append(.object(object))
			}
			let audit = try Row.fetchAll(db, sql: "SELECT * FROM memory_audit_log WHERE memory_id = ? ORDER BY created_at ASC", arguments: [id]).map { row -> JSONValue in
				var object: [String: JSONValue] = [
					"id": .string(row["id"]), "userId": .string(row["user_id"]), "action": .string(row["action"]), "createdAt": .string(row["created_at"]),
				]
				if let value: String = row["memory_id"] { object["memoryId"] = .string(value) }
				if let value: String = row["detail_json"], let parsed = try? JSONValue(parsing: value) { object["detail"] = parsed }
				return .object(object)
			}
			return ["item": Self.json(item), "sources": .array(sources), "auditTrail": .array(audit)]
		}
	}

	// MARK: Writes

	public struct Draft: Sendable {
		public var type: String
		public var subject: String?
		public var value: String
		public var confidence: Double
		public var sensitivity: String
		public var visibility: String
		public var expiresAt: String?

		public init(type: String = "fact", subject: String? = nil, value: String, confidence: Double = 1, sensitivity: String = "normal", visibility: String = "usable_by_ai", expiresAt: String? = nil) {
			self.type = type
			self.subject = subject
			self.value = value
			self.confidence = confidence
			self.sensitivity = sensitivity
			self.visibility = visibility
			self.expiresAt = expiresAt
		}
	}

	/// Create from manual input (merges into an exact/near duplicate).
	public func createManual(_ draft: Draft) async throws -> JSONValue {
		var draft = draft
		draft.value = draft.value.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !draft.value.isEmpty else { throw TodoError.invalid("Memory value is required") }
		draft.subject = draft.subject?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
		let sourceID = try await writer.write { db in
			try self.insertSource(db, system: "manual", metadata: ["manual": true])
		}
		let (item, merged) = try await persistNewOrMerge(draft, sourceID: sourceID)
		if !merged {
			try await writer.write { db in
				try self.audit(db, memoryID: item.id, action: "saved", detail: ["reason": "Manual creation", "autoSaved": false, "manual": true])
			}
		}
		return Self.json(item)
	}

	/// Propose a memory from a source; auto-saves when policy allows.
	public func propose(_ draft: Draft, system: String, sourceID externalID: String? = nil, sourceURL: String? = nil, excerpt: String? = nil, reason: String) async throws -> JSONValue {
		let sensitivity = MemoryPolicy.classifySensitivity(type: draft.type, subject: draft.subject, value: draft.value)
		let visibility = MemoryPolicy.suggestVisibility(sensitivity: sensitivity, type: draft.type, explicit: MemoryPolicy.isExplicit(draft.value))
		let candidate: JSONValue = [
			"userId": .string(Self.defaultUser), "type": .string(draft.type), "subject": draft.subject.map(JSONValue.string) ?? .null,
			"value": .string(draft.value), "confidence": .number(draft.confidence), "sensitivity": .string(draft.sensitivity),
			"visibility": .string(draft.visibility), "expiresAt": draft.expiresAt.map(JSONValue.string) ?? .null,
		]
		let (sourceID, proposalID) = try await writer.write { db -> (String, String) in
			let sourceID = try self.insertSource(db, system: system, sourceID: externalID, url: sourceURL, excerpt: excerpt)
			let proposalID = UUID().uuidString.lowercased()
			try db.execute(sql: """
			INSERT INTO memory_proposals (id, user_id, status, candidate_json, source_id, confidence, sensitivity, suggested_visibility, reason, created_at)
			VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
			""", arguments: [proposalID, Self.defaultUser, candidate.jsonString(), sourceID, draft.confidence, sensitivity, visibility, reason, Self.now()])
			return (sourceID, proposalID)
		}
		if MemoryPolicy.shouldAutoSave(sensitivity: sensitivity, confidence: draft.confidence, type: draft.type) {
			var saved = draft
			saved.sensitivity = sensitivity
			saved.visibility = visibility
			let (item, _) = try await persistNewOrMerge(saved, sourceID: sourceID)
			try await writer.write { db in
				try db.execute(sql: "UPDATE memory_proposals SET status = 'accepted', resolved_at = ? WHERE id = ?", arguments: [Self.now(), proposalID])
				try self.audit(db, memoryID: item.id, action: "saved", detail: ["reason": .string(reason), "autoSaved": true, "proposalId": .string(proposalID)])
			}
			return ["id": .string(proposalID), "status": "accepted", "memory": Self.json(item)]
		}
		try await writer.write { db in
			try self.audit(db, memoryID: nil, action: "proposed", detail: [
				"reason": .string(reason), "proposalId": .string(proposalID), "sensitivity": .string(sensitivity), "suggestedVisibility": .string(visibility),
			])
		}
		return ["id": .string(proposalID), "status": "pending", "sensitivity": .string(sensitivity), "suggestedVisibility": .string(visibility)]
	}

	/// Save a pending proposal as a memory.
	public func save(proposalID: String) async throws -> JSONValue {
		guard let row = try await writer.read({ db in
			try Row.fetchOne(db, sql: "SELECT * FROM memory_proposals WHERE id = ? AND user_id = ?", arguments: [proposalID, Self.defaultUser])
				.map { (status: $0["status"] as String, candidate: $0["candidate_json"] as String, sourceID: $0["source_id"] as String,
				        sensitivity: $0["sensitivity"] as String, visibility: $0["suggested_visibility"] as String, confidence: $0["confidence"] as Double) }
		}) else { throw TodoError("not_found", "Proposal \(proposalID) not found", status: 404) }
		guard row.status == "pending" else { throw TodoError("not_pending", "Proposal \(proposalID) is \(row.status), not pending", status: 409) }
		let candidate = (try? JSONValue(parsing: row.candidate)) ?? .object([:])
		let draft = Draft(
			type: candidate["type"]?.stringValue ?? "fact", subject: candidate["subject"]?.stringValue, value: candidate["value"]?.stringValue ?? "",
			confidence: row.confidence, sensitivity: row.sensitivity, visibility: row.visibility, expiresAt: candidate["expiresAt"]?.stringValue,
		)
		let (item, _) = try await persistNewOrMerge(draft, sourceID: row.sourceID)
		try await writer.write { db in
			try db.execute(sql: "UPDATE memory_proposals SET status = 'accepted', resolved_at = ? WHERE id = ?", arguments: [Self.now(), proposalID])
			try self.audit(db, memoryID: item.id, action: "saved", detail: ["proposalId": .string(proposalID), "autoSaved": false])
		}
		return Self.json(item)
	}

	public struct Patch: Sendable {
		public var value: String?
		public var subject: String?
		public var type: String?
		public var sensitivity: String?
		public var visibility: String?
		public var confidence: Double?
		/// `.some(nil)` clears the expiry.
		public var expiresAt: String??

		public init(value: String? = nil, subject: String? = nil, type: String? = nil, sensitivity: String? = nil, visibility: String? = nil, confidence: Double? = nil, expiresAt: String?? = nil) {
			self.value = value
			self.subject = subject
			self.type = type
			self.sensitivity = sensitivity
			self.visibility = visibility
			self.confidence = confidence
			self.expiresAt = expiresAt
		}

		var json: JSONValue {
			var object: [String: JSONValue] = [:]
			if let value { object["value"] = .string(value) }
			if let subject { object["subject"] = .string(subject) }
			if let type { object["type"] = .string(type) }
			if let sensitivity { object["sensitivity"] = .string(sensitivity) }
			if let visibility { object["visibility"] = .string(visibility) }
			if let confidence { object["confidence"] = .number(confidence) }
			if let expiresAt { object["expiresAt"] = expiresAt.map(JSONValue.string) ?? .null }
			return .object(object)
		}
	}

	func applyPatch(_ db: Database, id: String, _ patch: Patch) throws -> MemoryRecord? {
		guard let existing = try item(db, id: id) else { return nil }
		var sets = ["updated_at = ?"]
		var arguments: [(any DatabaseValueConvertible)?] = [Self.now()]
		if let value = patch.value { sets.append("value = ?"); arguments.append(value) }
		if let confidence = patch.confidence { sets.append("confidence = ?"); arguments.append(confidence) }
		if let sensitivity = patch.sensitivity { sets.append("sensitivity = ?"); arguments.append(sensitivity) }
		if let visibility = patch.visibility { sets.append("visibility = ?"); arguments.append(visibility) }
		if let subject = patch.subject { sets.append("subject = ?"); arguments.append(subject) }
		if let type = patch.type { sets.append("type = ?"); arguments.append(type) }
		if let expiresAt = patch.expiresAt { sets.append("expires_at = ?"); arguments.append(expiresAt) }
		if patch.value != nil || patch.subject != nil {
			sets.append("content_hash = ?")
			arguments.append(MemoryText.contentHash(patch.value ?? existing.value, subject: patch.subject ?? existing.subject))
		}
		arguments += [id, Self.defaultUser]
		try db.execute(sql: "UPDATE memory_items SET \(sets.joined(separator: ", ")) WHERE id = ? AND user_id = ?", arguments: StatementArguments(arguments))
		return try item(db, id: id)
	}

	public func update(_ id: String, _ patch: Patch) async throws -> JSONValue {
		let textChanged = patch.value != nil || patch.subject != nil
		let updated = try await writer.write { db -> MemoryRecord in
			guard let updated = try self.applyPatch(db, id: id, patch) else {
				throw TodoError("not_found", "Memory not found", status: 404)
			}
			try? GraphStore.syncMemoryNode(db, updated, textChanged: textChanged)
			try self.audit(db, memoryID: id, action: "updated", detail: ["patch": patch.json])
			return updated
		}
		if textChanged { await storeEmbedding(for: updated) }
		return try await writer.read { db in try self.item(db, id: id) }.map(Self.json) ?? Self.json(updated)
	}

	public func forget(_ id: String) throws {
		try writer.write { db in
			guard try self.item(db, id: id) != nil else { throw TodoError("not_found", "Memory not found", status: 404) }
			try db.execute(sql: "DELETE FROM memory_item_sources WHERE memory_id = ?", arguments: [id])
			try db.execute(sql: "DELETE FROM memory_embeddings WHERE memory_id = ?", arguments: [id])
			try db.execute(sql: "DELETE FROM memory_items WHERE id = ? AND user_id = ?", arguments: [id, Self.defaultUser])
			try? GraphStore.removeMemoryNode(db, memoryID: id)
			try self.audit(db, memoryID: id, action: "forgotten")
		}
	}

	// MARK: Dedup / merge

	func persistNewOrMerge(_ draft: Draft, sourceID: String) async throws -> (MemoryRecord, merged: Bool) {
		let hash = MemoryText.contentHash(draft.value, subject: draft.subject)
		if let exact = try await writer.read({ db in
			try self.items(db, sql: "\(Self.itemSelect) WHERE i.user_id = ? AND i.content_hash = ? ORDER BY i.updated_at DESC LIMIT 1", arguments: [Self.defaultUser, hash]).first
		}) {
			return (try await merge(draft, into: exact, sourceID: sourceID, score: 1, reason: "exact", updateValue: false, vector: nil), true)
		}
		let embedder = embedder()
		let vector = try? await embedder?.embed([MemoryText.embedText(value: draft.value, subject: draft.subject)]).first
		if let vector, let embedder, let near = try await nearDuplicate(vector: vector, type: draft.type, modelID: embedder.modelID) {
			let updateValue = near.reason == "near-dup" && MemoryText.isMoreSpecific(draft.value, than: near.item.value)
			return (try await merge(draft, into: near.item, sourceID: sourceID, score: near.score, reason: near.reason, updateValue: updateValue, vector: updateValue ? vector : nil), true)
		}
		let item = try await writer.write { db -> MemoryRecord in
			let id = UUID().uuidString.lowercased()
			let ts = Self.now()
			try db.execute(sql: """
			INSERT INTO memory_items (id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, content_hash, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""", arguments: [id, Self.defaultUser, draft.type, draft.subject, draft.value, draft.confidence, draft.sensitivity, draft.visibility, draft.expiresAt, hash, ts, ts])
			try db.execute(sql: "INSERT OR IGNORE INTO memory_item_sources (memory_id, source_id) VALUES (?, ?)", arguments: [id, sourceID])
			let inserted = try self.item(db, id: id)!
			try? GraphStore.syncMemoryNode(db, inserted, textChanged: true)
			return inserted
		}
		if let vector, let embedder {
			try await saveEmbedding(item.id, vector, modelID: embedder.modelID)
		}
		return (try await writer.read { db in try self.item(db, id: item.id) } ?? item, false)
	}

	func merge(_ draft: Draft, into existing: MemoryRecord, sourceID: String, score: Float, reason: String, updateValue: Bool, vector: [Float]?) async throws -> MemoryRecord {
		var patch = Patch()
		if updateValue { patch.value = draft.value }
		let confidence = max(existing.confidence, draft.confidence)
		patch.confidence = confidence
		let finalPatch = patch
		let updated = try await writer.write { db -> MemoryRecord in
			try db.execute(sql: "INSERT OR IGNORE INTO memory_item_sources (memory_id, source_id) VALUES (?, ?)", arguments: [existing.id, sourceID])
			let item = try self.applyPatch(db, id: existing.id, finalPatch) ?? existing
			try? GraphStore.syncMemoryNode(db, item, textChanged: updateValue)
			try self.audit(db, memoryID: existing.id, action: "merged", detail: [
				"reason": .string(reason), "score": .number(Double(score)), "sourceId": .string(sourceID), "updatedValue": .bool(updateValue),
			])
			return item
		}
		if updateValue {
			if let vector, let embedder = embedder() {
				try await saveEmbedding(updated.id, vector, modelID: embedder.modelID)
			} else {
				await storeEmbedding(for: updated)
			}
		}
		return try await writer.read { db in try self.item(db, id: existing.id) } ?? updated
	}

	func nearDuplicate(vector: [Float], type: String, modelID: String) async throws -> (item: MemoryRecord, score: Float, reason: String)? {
		let candidates = try await embeddings(modelID: modelID)
		guard let best = VectorMath.topK(query: vector, candidates: candidates.map { ($0.id, $0.vector) }, k: 1, minScore: Self.nearDuplicate).first,
		      let item = try await writer.read({ db in try self.item(db, id: best.id) })
		else { return nil }
		if best.score >= Self.nearExact { return (item, best.score, "near-exact") }
		return item.type == type ? (item, best.score, "near-dup") : nil
	}

	// MARK: Embeddings

	func embeddings(modelID: String, visibilities: Set<String>? = nil) async throws -> [(id: String, vector: [Float])] {
		try await writer.read { db in
			try Row.fetchAll(db, sql: """
			SELECT e.memory_id, e.embedding_blob, i.visibility FROM memory_embeddings e JOIN memory_items i ON i.id = e.memory_id
			WHERE i.user_id = ? AND e.model = ?
			""", arguments: [Self.defaultUser, modelID]).compactMap { row in
				if let visibilities, !visibilities.contains(row["visibility"] as String) { return nil }
				return (row["memory_id"] as String, VectorMath.vector(fromBlob: row["embedding_blob"] as Data))
			}
		}
	}

	func saveEmbedding(_ id: String, _ vector: [Float], modelID: String) async throws {
		try await writer.write { db in
			try db.execute(sql: "INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding_blob, model, created_at) VALUES (?, ?, ?, ?)",
			               arguments: [id, VectorMath.blob(vector), modelID, Self.now()])
		}
	}

	func storeEmbedding(for item: MemoryRecord) async {
		guard let embedder = embedder(),
		      let vector = try? await embedder.embed([MemoryText.embedText(value: item.value, subject: item.subject)]).first
		else { return }
		try? await saveEmbedding(item.id, vector, modelID: embedder.modelID)
	}

	/// Embed memories missing a vector for the current model (64 per call).
	public func backfillEmbeddings() async {
		guard let embedder = embedder() else { return }
		guard let missing = try? await writer.read({ db in
			try Row.fetchAll(db, sql: """
			SELECT i.id, i.subject, i.value FROM memory_items i LEFT JOIN memory_embeddings e ON e.memory_id = i.id
			WHERE i.user_id = ? AND (e.memory_id IS NULL OR e.model != ?)
			""", arguments: [Self.defaultUser, embedder.modelID]).map { row -> (id: String, text: String) in
				(row["id"], MemoryText.embedText(value: row["value"], subject: row["subject"]))
			}
		}) else { return }
		for start in stride(from: 0, to: missing.count, by: 64) {
			let batch = Array(missing[start ..< min(start + 64, missing.count)])
			guard let vectors = try? await embedder.embed(batch.map(\.text)) else { return }
			for (entry, vector) in zip(batch, vectors) {
				try? await saveEmbedding(entry.id, vector, modelID: embedder.modelID)
			}
		}
	}

	func semanticHits(_ query: String, visibilities: Set<String>? = nil, topK: Int = searchTopK) async -> [String: Float] {
		guard let embedder = embedder() else { return [:] }
		await backfillEmbeddings()
		guard let vector = try? await embedder.embed([query]).first,
		      let candidates = try? await embeddings(modelID: embedder.modelID, visibilities: visibilities)
		else { return [:] }
		let hits = VectorMath.topK(query: vector, candidates: candidates, k: topK, minScore: Self.searchMinScore)
		return Dictionary(hits.map { ($0.id, $0.score) }, uniquingKeysWith: { a, _ in a })
	}

	/// Relevant memories for a task (chat context). Excludes private and, by
	/// default, unconfirmed memories.
	public func retrieve(for task: String, includeUnconfirmed: Bool = false, maxItems: Int = 10) async throws -> JSONValue {
		let visibilities: Set<String> = includeUnconfirmed ? ["usable_by_ai", "requires_confirmation"] : ["usable_by_ai"]
		let keywords = MemoryText.keywords(task)
		let fetchLimit = max(maxItems * 5, 25)
		let visibilityList = visibilities.sorted()
		let marks = Array(repeating: "?", count: visibilityList.count).joined(separator: ",")
		var byID: [String: MemoryRecord] = [:]
		let keywordCandidates = try await writer.read { db -> [MemoryRecord] in
			var arguments: [any DatabaseValueConvertible] = [Self.defaultUser]
			arguments += visibilityList as [any DatabaseValueConvertible]
			if keywords.isEmpty {
				arguments.append(fetchLimit)
				return try self.items(db, sql: "\(Self.itemSelect) WHERE i.user_id = ? AND i.visibility IN (\(marks)) ORDER BY i.confidence DESC, i.updated_at DESC LIMIT ?", arguments: StatementArguments(arguments))
			}
			let clause = Array(repeating: "(i.value LIKE ? ESCAPE '!' OR i.subject LIKE ? ESCAPE '!')", count: keywords.count).joined(separator: " OR ")
			for keyword in keywords {
				let pattern = "%\(MemoryText.escapeLike(keyword))%"
				arguments += [pattern, pattern]
			}
			arguments.append(fetchLimit)
			return try self.items(db, sql: "\(Self.itemSelect) WHERE i.user_id = ? AND i.visibility IN (\(marks)) AND (\(clause)) ORDER BY i.confidence DESC, i.updated_at DESC LIMIT ?", arguments: StatementArguments(arguments))
		}
		for item in keywordCandidates { byID[item.id] = item }
		let semantic = await semanticHits(task, visibilities: visibilities, topK: fetchLimit)
		let known = Set(byID.keys)
		let extra = try await writer.read { db in
			try semantic.keys.filter { !known.contains($0) }.compactMap { try self.item(db, id: $0) }.filter { visibilities.contains($0.visibility) }
		}
		for item in extra { byID[item.id] = item }
		let memories = Array(MemoryText.rank(Array(byID.values), query: task, keywords: keywords, semantic: semantic).prefix(maxItems))
		let omitted = try await writer.write { db -> Int in
			let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM memory_items WHERE user_id = ? AND visibility NOT IN ('usable_by_ai')", arguments: [Self.defaultUser]) ?? 0
			try self.audit(db, memoryID: nil, action: "retrieved", detail: ["taskDescription": .string(task), "returnedCount": .number(Double(memories.count)), "omittedCount": .number(Double(count))])
			return count
		}
		let summary = memories.isEmpty
			? "No relevant memories found."
			: "\(memories.count) relevant memory(ies): " + memories.map { "(\($0.type)) \($0.subject ?? String($0.value.prefix(60)))" }.joined(separator: "; ")
		return [
			"memories": .array(memories.map(Self.json)),
			"summary": .string(summary),
			"omitted": ["count": .number(Double(omitted)), "reason": "Private or requires-confirmation memories excluded from normal retrieval"],
		]
	}
}
