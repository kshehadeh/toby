import Foundation
import GRDB
import TobyAI

/// Graph enrichment queue, semantic links, entity extraction, prompt context
/// (port of `graph/enrichment.ts`, `query.ts` `contextFor`, `memory-backfill.ts`).
public enum GraphEnrichment {
	static let semanticThreshold: Float = 0.8
	static let extractionBudget = 300
	static let extractionBatch = 8
	static let lookback: TimeInterval = 45 * 86400

	public typealias Extract = @Sendable (_ nodes: [GraphNode]) async throws -> JSONValue

	public struct Stats: Sendable, Equatable {
		public var processed = 0
		public var embedded = 0
		public var semanticEdges = 0
		public var extracted = 0
		public var skipped = 0
		public var errors = 0
	}

	// MARK: Queue

	static func due(_ db: Database, limit: Int, now: String) throws -> [(nodeID: String, steps: [String])] {
		try Row.fetchAll(db, sql: "SELECT node_id, steps_json FROM graph_enrich_queue WHERE next_attempt_at <= ? ORDER BY enqueued_at ASC LIMIT ?", arguments: [now, max(1, limit)]).map {
			($0["node_id"], ((try? JSONDecoder().decode([String].self, from: Data(($0["steps_json"] as String).utf8))) ?? []))
		}
	}

	static func complete(_ db: Database, _ nodeID: String, _ done: [String]) throws {
		guard let raw = try String.fetchOne(db, sql: "SELECT steps_json FROM graph_enrich_queue WHERE node_id = ?", arguments: [nodeID]) else { return }
		let remaining = ((try? JSONDecoder().decode([String].self, from: Data(raw.utf8))) ?? []).filter { !done.contains($0) }
		if remaining.isEmpty {
			try db.execute(sql: "DELETE FROM graph_enrich_queue WHERE node_id = ?", arguments: [nodeID])
		} else {
			try db.execute(sql: "UPDATE graph_enrich_queue SET steps_json = ? WHERE node_id = ?", arguments: [JSONValue.array(remaining.map(JSONValue.string)).jsonString(), nodeID])
		}
	}

	static func defer_(_ db: Database, _ nodeID: String, until: Date) throws {
		try db.execute(sql: "UPDATE graph_enrich_queue SET next_attempt_at = ? WHERE node_id = ?", arguments: [TodoRecurrence.isoString(until), nodeID])
	}

	/// Back off 1, 2, 4, 8 minutes; give up after five attempts.
	static func fail(_ db: Database, _ nodeID: String, _ error: String, now: Date) throws {
		guard let attemptsSoFar = try Int.fetchOne(db, sql: "SELECT attempts FROM graph_enrich_queue WHERE node_id = ?", arguments: [nodeID]) else { return }
		let attempts = attemptsSoFar + 1
		if attempts >= 5 {
			try db.execute(sql: "DELETE FROM graph_enrich_queue WHERE node_id = ?", arguments: [nodeID])
			return
		}
		try db.execute(sql: "UPDATE graph_enrich_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE node_id = ?",
		               arguments: [attempts, String(error.prefix(500)), TodoRecurrence.isoString(now.addingTimeInterval(60 * pow(2, Double(attempts - 1)))), nodeID])
	}

	static func claimBudget(_ db: Database, key: String, count: Int, max: Int) throws -> Int {
		let used = Int(try String.fetchOne(db, sql: "SELECT value FROM graph_meta WHERE key = ?", arguments: [key]) ?? "0") ?? 0
		let allowed = Swift.max(0, Swift.min(count, max - used))
		if allowed > 0 {
			try db.execute(sql: "INSERT INTO graph_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", arguments: [key, String(used + allowed)])
		}
		return allowed
	}

	static func utcDay(_ date: Date) -> String { String(TodoRecurrence.isoString(date).prefix(10)) }

	// MARK: Run

	static func nodeText(_ node: GraphNode) -> String {
		String("\(node.label)\n\(node.props["text"]?.stringValue ?? "")".trimmingCharacters(in: .whitespacesAndNewlines).prefix(3000))
	}

	/// Drain due enrichment: embed (with semantic `related_to` links) and extract entities.
	public static func run(writer: any DatabaseWriter, embedder: (any TextEmbedder)?, extract: Extract?, now: Date = Date(), limit: Int = 100) async throws -> Stats {
		var stats = Stats()
		let queue = try await writer.read { db in try due(db, limit: limit, now: TodoRecurrence.isoString(now)) }
		let cutoff = TodoRecurrence.isoString(now.addingTimeInterval(-lookback))
		var toExtract: [GraphNode] = []
		for entry in queue {
			guard let node = try await writer.read({ db in try GraphStore.node(db, id: entry.nodeID) }), GraphStore.isVisible(node, now: now) else {
				try await writer.write { db in try complete(db, entry.nodeID, entry.steps) }
				stats.skipped += 1
				continue
			}
			if entry.steps.contains("embed") {
				do {
					if let embedder {
						var text = nodeText(node)
						if node.type == "memory", node.refTable == "memory_items", let refID = node.refID,
						   let memory = try await writer.read({ db in
						   	try Row.fetchOne(db, sql: "SELECT subject, value FROM memory_items WHERE id = ?", arguments: [refID]).map { (value: $0["value"] as String, subject: $0["subject"] as String?) }
						   }) {
							text = MemoryText.embedText(value: memory.value, subject: memory.subject)
						}
						guard let vector = try await embedder.embed([text]).first else { throw AIError.invalidResponse("No embedding returned") }
						let model = embedder.modelID
						let edges = try await writer.write { db -> Int in
							if node.type == "memory", node.refTable == "memory_items", let refID = node.refID {
								try db.execute(sql: "INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding_blob, model, created_at) VALUES (?, ?, ?, ?)",
								               arguments: [refID, VectorMath.blob(vector), model, TodoRecurrence.isoString(now)])
							} else {
								try db.execute(sql: "INSERT OR REPLACE INTO graph_embeddings (node_id, embedding_blob, model, created_at) VALUES (?, ?, ?, ?)",
								               arguments: [node.id, VectorMath.blob(vector), model, TodoRecurrence.isoString(now)])
							}
							_ = try GraphStore.removeEdgesTouching(db, nodeID: node.id, origin: "semantic", type: "related_to")
							let candidates = try Row.fetchAll(db, sql: """
							SELECT e.node_id, e.embedding_blob FROM graph_embeddings e JOIN graph_nodes n ON n.id = e.node_id
							WHERE e.model = ? AND e.node_id != ? AND n.type = 'observation' AND n.visibility = 'usable_by_ai'
							  AND COALESCE(json_extract(n.props_json, '$.occurredAt'), n.updated_at) >= ?
							UNION ALL
							SELECT n.id, e.embedding_blob FROM graph_nodes n JOIN memory_embeddings e ON e.memory_id = n.ref_id
							WHERE n.type = 'memory' AND n.ref_table = 'memory_items' AND n.id != ? AND n.visibility = 'usable_by_ai' AND e.model = ?
							""", arguments: [model, node.id, cutoff, node.id, model]).map { (id: $0["node_id"] as String, vector: VectorMath.vector(fromBlob: $0["embedding_blob"])) }
							let matches = VectorMath.topK(query: vector, candidates: candidates, k: 5, minScore: semanticThreshold)
							for match in matches {
								_ = try GraphStore.upsertEdge(db, src: node.id, dst: match.id, type: "related_to", weight: Double(match.score), confidence: Double(match.score), origin: "semantic")
							}
							try complete(db, node.id, ["embed"])
							return matches.count
						}
						stats.semanticEdges += edges
						stats.embedded += 1
					} else {
						try await writer.write { db in try complete(db, node.id, ["embed"]) }
						stats.skipped += 1
					}
				} catch {
					try await writer.write { db in try fail(db, node.id, "\(error)", now: now) }
					stats.errors += 1
				}
			}
			if entry.steps.contains("extract") { toExtract.append(node) }
			stats.processed += 1
		}
		guard let extract else { return stats }
		let budgetKey = "extractions:\(utcDay(now))"
		var tomorrow = Calendar(identifier: .gregorian)
		tomorrow.timeZone = TimeZone(identifier: "UTC")!
		let nextDay = tomorrow.date(byAdding: .day, value: 1, to: tomorrow.startOfDay(for: now)) ?? now
		for start in stride(from: 0, to: toExtract.count, by: extractionBatch) {
			let batch = Array(toExtract[start ..< min(start + extractionBatch, toExtract.count)])
			let allowed = try await writer.write { db -> Int in
				let allowed = try claimBudget(db, key: budgetKey, count: batch.count, max: extractionBudget)
				for node in batch.dropFirst(allowed) { try defer_(db, node.id, until: nextDay) }
				return allowed
			}
			guard allowed > 0 else { continue }
			let nodes = Array(batch.prefix(allowed))
			do {
				let output = try await extract(nodes)
				stats.extracted += try await writer.write { db in
					let created = try applyExtraction(db, nodes: nodes, output)
					for node in nodes { try complete(db, node.id, ["extract"]) }
					return created
				}
			} catch {
				try await writer.write { db in for node in nodes { try fail(db, node.id, "\(error)", now: now) } }
				stats.errors += nodes.count
			}
		}
		return stats
	}

	// MARK: Extraction

	static let extractedEntity: JSONSchema = .object([
		"type": .string(enum: ["person", "org", "project", "topic"]),
		"name": .string(),
		"identifiers": .array(.string()),
		"confidence": .number(),
	])

	public static let extractionSchema: JSONSchema = .object([
		"entities": .array(extractedEntity),
		"links": .array(.object(["nodeId": .string(), "entity": extractedEntity, "edgeType": .string(enum: ["mentions", "about", "works_at", "alias_of"])])),
	])

	static func entityNode(_ entity: JSONValue) -> GraphNodeInput? {
		guard let type = entity["type"]?.stringValue, ["person", "org", "project", "topic"].contains(type),
		      let name = entity["name"]?.stringValue?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { return nil }
		let identifiers = (entity["identifiers"]?.arrayValue ?? []).compactMap(\.stringValue)
		let email = identifiers.first { $0.contains("@") }
		let key = type == "person" && email != nil ? GraphStore.emailPersonKey(email!) : GraphStore.entityNameKey(name)
		return GraphNodeInput(type: type, key: key, label: name, props: identifiers.isEmpty ? [:] : ["identifiers": .array(identifiers.map(JSONValue.string))])
	}

	static func applyExtraction(_ db: Database, nodes: [GraphNode], _ output: JSONValue) throws -> Int {
		let allowed = Set(nodes.map(\.id))
		var created = 0
		for entity in output["entities"]?.arrayValue ?? [] where (entity["confidence"]?.doubleValue ?? 0) >= 0.7 {
			guard let input = entityNode(entity) else { continue }
			_ = try GraphStore.upsertNode(db, input)
			created += 1
		}
		for link in output["links"]?.arrayValue ?? [] {
			guard let nodeID = link["nodeId"]?.stringValue, allowed.contains(nodeID), let entity = link["entity"], (entity["confidence"]?.doubleValue ?? 0) >= 0.7,
			      let type = link["edgeType"]?.stringValue, let source = try GraphStore.node(db, id: nodeID), GraphStore.isVisible(source),
			      let input = entityNode(entity) else { continue }
			let confidence = entity["confidence"]?.doubleValue ?? 0.7
			let entityID = try GraphStore.upsertNode(db, input)
			_ = try GraphStore.upsertEdge(db, src: nodeID, dst: entityID, type: type, weight: confidence, confidence: confidence, origin: "extracted", provenanceNodeID: nodeID)
			created += 1
			guard entity["type"] == "person" else { continue }
			for email in (entity["identifiers"]?.arrayValue ?? []).compactMap(\.stringValue) where email.contains("@") {
				let stable = try GraphStore.upsertNode(db, GraphNodeInput(type: "person", key: GraphStore.emailPersonKey(email), label: input.label, props: ["email": .string(email.trimmingCharacters(in: .whitespaces).lowercased())]))
				if stable != entityID {
					_ = try GraphStore.upsertEdge(db, src: entityID, dst: stable, type: "alias_of", weight: confidence, confidence: confidence, origin: "extracted", provenanceNodeID: nodeID)
				}
			}
		}
		return created
	}

	/// The model call the follow-up evaluator uses for extraction.
	public static func modelExtractor(_ model: LanguageModel) -> Extract {
		{ nodes in
			let payload: JSONValue = ["nodes": .array(nodes.map { ["nodeId": .string($0.id), "type": .string($0.type), "label": .string($0.label), "text": .string(String(($0.props["text"]?.stringValue ?? "").prefix(1000)))] })]
			return try await generateJSON(ObjectRequest(
				model: model,
				instructions: "Extract only explicit entities and relationships stated in the supplied Toby evidence. Do not infer identities. Use stable identifiers only when present verbatim. Confidence must reflect evidence strength.",
				messages: [.user(payload.jsonString())], schema: extractionSchema, schemaName: "TobyGraphEntities",
				schemaDescription: "Entities and evidence-backed links for a bounded graph batch", maxOutputTokens: 1600,
			)).object
		}
	}

	// MARK: Context

	/// Compact neighborhood text for a prompt, nearest and strongest first.
	public static func context(_ db: Database, ids: [String], depth: Int = 2, limit: Int = 60, maxChars: Int = 4000, filter: (GraphNode) -> Bool = { _ in true }) throws -> (text: String, nodes: [GraphStore.Neighbor]) {
		var lines: [String] = []
		var kept: [GraphStore.Neighbor] = []
		var used = 0
		for hit in try GraphStore.neighbors(db, from: ids, depth: depth, limit: limit) where filter(hit.node) {
			let text = (hit.node.props["text"]?.stringValue).map(MemoryText.collapseWhitespace).flatMap { $0.isEmpty ? nil : ": \(String($0.prefix(240)))" } ?? ""
			let line = "- [\(hit.node.type)] \(hit.node.label)\(text) (via \(hit.via.type)\(hit.depth > 1 ? ", \(hit.depth) hops" : ""))"
			if used + line.count + 1 > maxChars { break }
			lines.append(line)
			kept.append(hit)
			used += line.count + 1
		}
		return (lines.joined(separator: "\n"), kept)
	}

	// MARK: Memory backfill

	/// One-time: give every memory a graph node (and queue enrichment).
	@discardableResult
	public static func backfillMemories(_ db: Database) throws -> Int {
		let key = "memory_graph_backfill_v1"
		if try String.fetchOne(db, sql: "SELECT value FROM graph_meta WHERE key = ?", arguments: [key]) == "complete" { return 0 }
		var queued = 0
		for row in try Row.fetchAll(db, sql: "SELECT id, type, subject, value, sensitivity, visibility, expires_at FROM memory_items ORDER BY id") {
			let id: String = row["id"]
			let subject = (row["subject"] as String?)?.trimmingCharacters(in: .whitespaces).nilIfEmpty
			let value: String = row["value"]
			let visibility: String = row["visibility"]
			let node = GraphNodeInput(
				type: "memory", key: id, label: subject ?? String(value.trimmingCharacters(in: .whitespaces).prefix(80)),
				props: ["memoryType": .string(row["type"]), "text": .string(String(value.prefix(1000))), "subject": subject.map(JSONValue.string) ?? .null, "expiresAt": (row["expires_at"] as String?).map(JSONValue.string) ?? .null],
				sensitivity: row["sensitivity"], visibility: visibility, ref: ("memory_items", id),
			)
			let usable = visibility == "usable_by_ai"
			let edges = usable && subject != nil ? [GraphEdgeInput(src: node, dst: GraphNodeInput(type: "person", key: GraphStore.entityNameKey(subject!), label: subject), type: "about")] : []
			_ = try GraphStore.write(db, nodes: [node], edges: edges, enrich: usable ? ["embed", "extract"] : [])
			if usable { queued += 1 }
		}
		try db.execute(sql: "INSERT INTO graph_meta(key, value) VALUES(?, 'complete') ON CONFLICT(key) DO UPDATE SET value = 'complete'", arguments: [key])
		return queued
	}
}
