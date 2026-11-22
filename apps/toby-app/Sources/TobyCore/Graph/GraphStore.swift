import Foundation
import GRDB
import TobyAI

/// A graph node (port of `graph/types.ts`).
public struct GraphNode: Sendable, Hashable {
	public var id: String
	public var type: String
	public var key: String
	public var label: String
	public var props: [String: JSONValue]
	public var sensitivity: String
	public var visibility: String
	public var refTable: String?
	public var refID: String?
	public var createdAt: String
	public var updatedAt: String

	init(row: Row) {
		id = row["id"]
		type = row["type"]
		key = row["key"]
		label = row["label"]
		props = ((try? JSONValue(parsing: row["props_json"] as String? ?? "{}"))?.objectValue) ?? [:]
		sensitivity = row["sensitivity"]
		visibility = row["visibility"]
		refTable = row["ref_table"]
		refID = row["ref_id"]
		createdAt = row["created_at"]
		updatedAt = row["updated_at"]
	}

	public var json: JSONValue {
		var object: [String: JSONValue] = [
			"id": .string(id), "type": .string(type), "key": .string(key), "label": .string(label),
			"props": .object(props), "sensitivity": .string(sensitivity), "visibility": .string(visibility),
			"createdAt": .string(createdAt), "updatedAt": .string(updatedAt),
		]
		if let refTable, let refID { object["ref"] = ["table": .string(refTable), "id": .string(refID)] }
		return .object(object)
	}
}

public struct GraphEdge: Sendable, Hashable {
	public var id: String
	public var src: String
	public var dst: String
	public var type: String
	public var weight: Double
	public var confidence: Double
	public var origin: String
	public var occurrences: Int
	public var provenanceNodeID: String?
	public var reason: String?
	public var createdAt: String
	public var updatedAt: String

	init(row: Row) {
		id = row["id"]
		src = row["src"]
		dst = row["dst"]
		type = row["type"]
		weight = row["weight"]
		confidence = row["confidence"]
		origin = row["origin"]
		occurrences = row["occurrences"]
		provenanceNodeID = row["provenance_node_id"]
		reason = row["reason"]
		createdAt = row["created_at"]
		updatedAt = row["updated_at"]
	}

	public var json: JSONValue {
		var object: [String: JSONValue] = [
			"id": .string(id), "src": .string(src), "dst": .string(dst), "type": .string(type),
			"weight": .number(weight), "confidence": .number(confidence), "origin": .string(origin),
			"occurrences": .number(Double(occurrences)), "createdAt": .string(createdAt), "updatedAt": .string(updatedAt),
		]
		if let provenanceNodeID { object["provenanceNodeId"] = .string(provenanceNodeID) }
		if let reason, !reason.isEmpty { object["reason"] = .string(reason) }
		return .object(object)
	}
}

/// Node to upsert by `(type, key)`.
public struct GraphNodeInput: Sendable, Hashable {
	public var type: String
	public var key: String
	public var label: String?
	public var props: [String: JSONValue]?
	public var sensitivity: String?
	public var visibility: String?
	public var ref: (table: String, id: String)?

	public init(type: String, key: String, label: String? = nil, props: [String: JSONValue]? = nil, sensitivity: String? = nil, visibility: String? = nil, ref: (table: String, id: String)? = nil) {
		self.type = type
		self.key = key
		self.label = label
		self.props = props
		self.sensitivity = sensitivity
		self.visibility = visibility
		self.ref = ref
	}

	public static func == (a: GraphNodeInput, b: GraphNodeInput) -> Bool {
		a.type == b.type && a.key == b.key && a.label == b.label && a.props == b.props
			&& a.sensitivity == b.sensitivity && a.visibility == b.visibility && a.ref?.table == b.ref?.table && a.ref?.id == b.ref?.id
	}

	public func hash(into hasher: inout Hasher) {
		hasher.combine(type)
		hasher.combine(key)
	}
}

public struct GraphEdgeInput: Sendable {
	public var src: GraphNodeInput
	public var dst: GraphNodeInput
	public var type: String
	public var weight: Double?
	public var confidence: Double?
	public var origin: String?
	public var provenanceNodeID: String?
	public var reason: String?

	public init(src: GraphNodeInput, dst: GraphNodeInput, type: String, weight: Double? = nil, confidence: Double? = nil, origin: String? = nil, provenanceNodeID: String? = nil, reason: String? = nil) {
		self.src = src
		self.dst = dst
		self.type = type
		self.weight = weight
		self.confidence = confidence
		self.origin = origin
		self.provenanceNodeID = provenanceNodeID
		self.reason = reason
	}
}

/// Knowledge-graph persistence and queries (port of `graph/store.ts`,
/// `write.ts`, `query.ts`, `snapshot.ts`). All functions take a `Database`
/// so callers compose them into their own transactions.
public enum GraphStore {
	public static let nodeTypes = ["person", "org", "project", "topic", "thread", "observation", "memory", "todo", "event", "loop"]
	static let symmetricEdgeTypes: Set<String> = ["related_to", "alias_of"]
	static let nodeColumns = "id, type, key, label, props_json, sensitivity, visibility, ref_table, ref_id, created_at, updated_at"
	static let edgeColumns = "id, src, dst, type, weight, confidence, origin, occurrences, provenance_node_id, reason, created_at, updated_at"

	public static func now() -> String { TodoRecurrence.isoString(Date()) }
	static func clamp01(_ value: Double?, _ fallback: Double) -> Double {
		guard let value, value.isFinite else { return fallback }
		return min(1, max(0, value))
	}

	// MARK: Keys

	public static func entityNameKey(_ name: String) -> String {
		"name:\(name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " "))"
	}

	public static func emailPersonKey(_ address: String) -> String {
		"email:\(address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
	}

	// MARK: Reads

	public static func node(_ db: Database, id: String) throws -> GraphNode? {
		try Row.fetchOne(db, sql: "SELECT \(nodeColumns) FROM graph_nodes WHERE id = ?", arguments: [id]).map(GraphNode.init)
	}

	public static func findNode(_ db: Database, type: String, key: String) throws -> GraphNode? {
		try Row.fetchOne(db, sql: "SELECT \(nodeColumns) FROM graph_nodes WHERE type = ? AND key = ?", arguments: [type, key]).map(GraphNode.init)
	}

	public static func nodes(_ db: Database, ids: [String]) throws -> [GraphNode] {
		var out: [GraphNode] = []
		for start in stride(from: 0, to: ids.count, by: 400) {
			let chunk = Array(ids[start ..< min(start + 400, ids.count)])
			let marks = Array(repeating: "?", count: chunk.count).joined(separator: ",")
			out += try Row.fetchAll(db, sql: "SELECT \(nodeColumns) FROM graph_nodes WHERE id IN (\(marks))", arguments: StatementArguments(chunk)).map(GraphNode.init)
		}
		return out
	}

	public static func searchNodesByLabel(_ db: Database, query: String, limit: Int = 20) throws -> [GraphNode] {
		let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !needle.isEmpty else { return [] }
		return try Row.fetchAll(db, sql: """
		SELECT \(nodeColumns) FROM graph_nodes
		WHERE label LIKE ? ESCAPE '!' AND visibility = 'usable_by_ai'
		ORDER BY CASE WHEN lower(label) = lower(?) THEN 0 ELSE 1 END, updated_at DESC LIMIT ?
		""", arguments: ["%\(MemoryText.escapeLike(needle))%", needle, max(1, min(100, limit))]).map(GraphNode.init)
	}

	public static func edgesTouching(_ db: Database, ids: [String], edgeTypes: [String]? = nil, minWeight: Double = 0, minConfidence: Double = 0, fanout: Int = 50) throws -> [GraphEdge] {
		var typeClause = ""
		var typeArgs: [String] = []
		if let edgeTypes, !edgeTypes.isEmpty {
			typeClause = "AND type IN (\(Array(repeating: "?", count: edgeTypes.count).joined(separator: ",")))"
			typeArgs = edgeTypes
		}
		var out: [GraphEdge] = []
		for id in ids {
			var arguments: [any DatabaseValueConvertible] = [id, minWeight, minConfidence]
			arguments += typeArgs as [any DatabaseValueConvertible]
			arguments += [id, minWeight, minConfidence]
			arguments += typeArgs as [any DatabaseValueConvertible]
			arguments.append(max(1, fanout))
			out += try Row.fetchAll(db, sql: """
			SELECT \(edgeColumns) FROM (
			  SELECT \(edgeColumns) FROM graph_edges WHERE src = ? AND weight >= ? AND confidence >= ? \(typeClause)
			  UNION ALL
			  SELECT \(edgeColumns) FROM graph_edges WHERE dst = ? AND weight >= ? AND confidence >= ? \(typeClause)
			) ORDER BY weight DESC, updated_at DESC LIMIT ?
			""", arguments: StatementArguments(arguments)).map(GraphEdge.init)
		}
		return out
	}

	public static func counts(_ db: Database) throws -> (nodes: Int, edges: Int) {
		(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM graph_nodes") ?? 0, try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM graph_edges") ?? 0)
	}

	// MARK: Writes

	@discardableResult
	public static func upsertNode(_ db: Database, _ input: GraphNodeInput, ts: String = now()) throws -> String {
		let label = input.label?.trimmingCharacters(in: .whitespacesAndNewlines)
		if let existing = try Row.fetchOne(db, sql: "SELECT id, props_json FROM graph_nodes WHERE type = ? AND key = ?", arguments: [input.type, input.key]) {
			let id: String = existing["id"]
			var sets = ["updated_at = ?"]
			var arguments: [(any DatabaseValueConvertible)?] = [ts]
			if let label, !label.isEmpty { sets.append("label = ?"); arguments.append(label) }
			if let props = input.props, !props.isEmpty {
				var merged = (try? JSONValue(parsing: existing["props_json"] as String? ?? "{}"))?.objectValue ?? [:]
				merged.merge(props) { _, new in new }
				sets.append("props_json = ?")
				arguments.append(JSONValue.object(merged).jsonString())
			}
			if let sensitivity = input.sensitivity { sets.append("sensitivity = ?"); arguments.append(sensitivity) }
			if let visibility = input.visibility { sets.append("visibility = ?"); arguments.append(visibility) }
			if let ref = input.ref { sets.append("ref_table = ?, ref_id = ?"); arguments += [ref.table, ref.id] }
			arguments.append(id)
			try db.execute(sql: "UPDATE graph_nodes SET \(sets.joined(separator: ", ")) WHERE id = ?", arguments: StatementArguments(arguments))
			return id
		}
		let id = UUID().uuidString.lowercased()
		try db.execute(sql: "INSERT INTO graph_nodes (\(nodeColumns)) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", arguments: [
			id, input.type, input.key, (label?.isEmpty == false ? label : nil) ?? input.key,
			JSONValue.object(input.props ?? [:]).jsonString(), input.sensitivity ?? "normal", input.visibility ?? "usable_by_ai",
			input.ref?.table, input.ref?.id, ts, ts,
		])
		return id
	}

	@discardableResult
	public static func upsertEdge(_ db: Database, src srcID: String, dst dstID: String, type: String, weight: Double? = nil, confidence: Double? = nil, origin: String? = nil, provenanceNodeID: String? = nil, reason: String? = nil, ts: String = now()) throws -> String? {
		guard srcID != dstID else { return nil }
		var (src, dst) = (srcID, dstID)
		if symmetricEdgeTypes.contains(type), dst < src { swap(&src, &dst) }
		let w = clamp01(weight, 1)
		let c = clamp01(confidence, 1)
		if let existing = try Row.fetchOne(db, sql: "SELECT id, weight, confidence FROM graph_edges WHERE src = ? AND dst = ? AND type = ?", arguments: [src, dst, type]) {
			let id: String = existing["id"]
			try db.execute(sql: """
			UPDATE graph_edges SET weight = ?, confidence = ?, reason = COALESCE(?, reason), occurrences = occurrences + 1, updated_at = ? WHERE id = ?
			""", arguments: [max(existing["weight"] as Double, w), max(existing["confidence"] as Double, c), reason, ts, id])
			return id
		}
		let id = UUID().uuidString.lowercased()
		try db.execute(sql: "INSERT INTO graph_edges (\(edgeColumns)) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)", arguments: [
			id, src, dst, type, w, c, origin ?? "deterministic", provenanceNodeID, reason, ts, ts,
		])
		return id
	}

	/// Write nodes and edges (endpoints upserted by `(type, key)`), then queue
	/// enrichment for the primary nodes (port of `writeGraph`).
	@discardableResult
	public static func write(_ db: Database, nodes: [GraphNodeInput] = [], edges: [GraphEdgeInput] = [], enrich: [String] = []) throws -> (nodeIDs: [String], edgeIDs: [String]) {
		let ts = now()
		var ids: [String: String] = [:]
		func refKey(_ node: GraphNodeInput) -> String { "\(node.type)\u{0}\(node.key)" }
		func idFor(_ node: GraphNodeInput) throws -> String {
			if let known = ids[refKey(node)] { return known }
			let id = try upsertNode(db, node, ts: ts)
			ids[refKey(node)] = id
			return id
		}
		var nodeIDs: [String] = []
		for node in nodes {
			let id = try upsertNode(db, node, ts: ts)
			ids[refKey(node)] = id
			nodeIDs.append(id)
		}
		var edgeIDs: [String] = []
		for edge in edges {
			if let id = try upsertEdge(db, src: try idFor(edge.src), dst: try idFor(edge.dst), type: edge.type, weight: edge.weight, confidence: edge.confidence, origin: edge.origin, provenanceNodeID: edge.provenanceNodeID, reason: edge.reason, ts: ts) {
				edgeIDs.append(id)
			}
		}
		if !enrich.isEmpty {
			for id in nodeIDs { try enqueueEnrichment(db, nodeID: id, steps: enrich, ts: ts) }
		}
		return (nodeIDs, edgeIDs)
	}

	@discardableResult
	public static func deleteNode(_ db: Database, id: String) throws -> Bool {
		try db.execute(sql: "DELETE FROM graph_edges WHERE src = ? OR dst = ? OR provenance_node_id = ?", arguments: [id, id, id])
		try db.execute(sql: "DELETE FROM graph_embeddings WHERE node_id = ?", arguments: [id])
		try db.execute(sql: "DELETE FROM graph_enrich_queue WHERE node_id = ?", arguments: [id])
		try db.execute(sql: "DELETE FROM graph_nodes WHERE id = ?", arguments: [id])
		return db.changesCount > 0
	}

	/// Remove edges touching `nodeID` (optionally filtered); returns former neighbors.
	public static func removeEdgesTouching(_ db: Database, nodeID: String, origin: String? = nil, type: String? = nil) throws -> [String] {
		var clauses = ["(src = ? OR dst = ?)"]
		var arguments: [any DatabaseValueConvertible] = [nodeID, nodeID]
		if let origin { clauses.append("origin = ?"); arguments.append(origin) }
		if let type { clauses.append("type = ?"); arguments.append(type) }
		let whereClause = clauses.joined(separator: " AND ")
		let rows = try Row.fetchAll(db, sql: "SELECT src, dst FROM graph_edges WHERE \(whereClause)", arguments: StatementArguments(arguments))
		try db.execute(sql: "DELETE FROM graph_edges WHERE \(whereClause)", arguments: StatementArguments(arguments))
		var seen = Set<String>()
		var out: [String] = []
		for row in rows {
			let other: String = (row["src"] as String) == nodeID ? row["dst"] : row["src"]
			if seen.insert(other).inserted { out.append(other) }
		}
		return out
	}

	public static func enqueueEnrichment(_ db: Database, nodeID: String, steps: [String], ts: String = now()) throws {
		guard !steps.isEmpty else { return }
		var merged = Set(steps)
		if let existing = try String.fetchOne(db, sql: "SELECT steps_json FROM graph_enrich_queue WHERE node_id = ?", arguments: [nodeID]) {
			merged.formUnion(((try? JSONValue(parsing: existing))?.arrayValue ?? []).compactMap(\.stringValue))
		}
		let json = JSONValue.array(merged.sorted().map(JSONValue.string)).jsonString()
		try db.execute(sql: """
		INSERT INTO graph_enrich_queue (node_id, steps_json, attempts, enqueued_at, next_attempt_at) VALUES (?, ?, 0, ?, ?)
		ON CONFLICT(node_id) DO UPDATE SET steps_json = excluded.steps_json, attempts = 0, last_error = NULL, next_attempt_at = excluded.next_attempt_at
		""", arguments: [nodeID, json, ts, ts])
	}

	/// Delete entity neighbors (person/org/project/topic) left with no edges.
	static func pruneOrphanEntities(_ db: Database, _ ids: [String]) throws {
		for id in ids {
			guard let neighbor = try node(db, id: id), ["person", "org", "project", "topic"].contains(neighbor.type),
			      try edgesTouching(db, ids: [id]).isEmpty else { continue }
			try deleteNode(db, id: id)
		}
	}

	// MARK: Visibility & neighbors

	public static func isVisible(_ node: GraphNode, includeUnconfirmed: Bool = false, now: Date = Date()) -> Bool {
		if node.visibility == "private" { return false }
		if node.visibility == "requires_confirmation", !includeUnconfirmed { return false }
		if let expires = node.props["expiresAt"]?.stringValue, !expires.isEmpty, let at = TodoRecurrence.parseISO(expires), at <= now {
			return false
		}
		return true
	}

	public struct Neighbor: Sendable {
		public var node: GraphNode
		public var depth: Int
		public var via: GraphEdge
		public var score: Double

		public var json: JSONValue {
			["node": node.json, "depth": .number(Double(depth)), "via": via.json, "score": .number(score)]
		}
	}

	/// Breadth-first walk (both directions); hidden nodes are neither returned
	/// nor walked through.
	public static func neighbors(_ db: Database, from startIDs: [String], depth: Int = 1, edgeTypes: [String]? = nil, nodeTypes: Set<String>? = nil, minWeight: Double = 0, minConfidence: Double = 0, limit: Int = 100, fanout: Int = 50, includeUnconfirmed: Bool = false) throws -> [Neighbor] {
		let starts = try nodes(db, ids: startIDs).filter { isVisible($0, includeUnconfirmed: includeUnconfirmed) }.map(\.id)
		var visited = Set(starts)
		var results: [Neighbor] = []
		var frontier: [(id: String, score: Double)] = starts.map { ($0, 1) }
		var level = 1
		while level <= max(1, min(3, depth)), !frontier.isEmpty {
			let scoreByID = Dictionary(frontier.map { ($0.id, $0.score) }, uniquingKeysWith: { a, _ in a })
			var reached: [String: (via: GraphEdge, score: Double)] = [:]
			for edge in try edgesTouching(db, ids: frontier.map(\.id), edgeTypes: edgeTypes, minWeight: minWeight, minConfidence: minConfidence, fanout: fanout) {
				let fromSrc = scoreByID[edge.src] != nil
				let from = fromSrc ? edge.src : edge.dst
				let other = fromSrc ? edge.dst : edge.src
				if visited.contains(other) { continue }
				let score = (scoreByID[from] ?? 1) * edge.weight * edge.confidence
				if let previous = reached[other], previous.score >= score { continue }
				reached[other] = (edge, score)
			}
			var next: [(id: String, score: Double)] = []
			for node in try nodes(db, ids: Array(reached.keys)) {
				visited.insert(node.id)
				guard isVisible(node, includeUnconfirmed: includeUnconfirmed), let hit = reached[node.id] else { continue }
				next.append((node.id, hit.score))
				if nodeTypes?.contains(node.type) ?? true {
					results.append(Neighbor(node: node, depth: level, via: hit.via, score: hit.score))
				}
			}
			frontier = next
			level += 1
		}
		results.sort { $0.depth != $1.depth ? $0.depth < $1.depth : $0.score > $1.score }
		return Array(results.prefix(max(1, limit)))
	}

	// MARK: Snapshot (Connections view)

	/// Best-connected visible nodes of `types` and the edges among them
	/// (port of `graphSnapshot`). JSON matches `/api/graph`.
	public static func snapshot(_ db: Database, types requested: [String]? = nil, limit requestedLimit: Int? = nil, collapseObservations: Bool = true) throws -> JSONValue {
		let types = (requested?.isEmpty == false ? requested! : nodeTypes.filter { $0 != "observation" })
		let limit = max(1, min(500, requestedLimit ?? 200))
		let marks = Array(repeating: "?", count: types.count).joined(separator: ",")
		var arguments: [any DatabaseValueConvertible] = types
		arguments.append(limit + 1)
		let rows = try Row.fetchAll(db, sql: """
		SELECT \(nodeColumns),
		  (SELECT COUNT(*) FROM graph_edges WHERE src = n.id) + (SELECT COUNT(*) FROM graph_edges WHERE dst = n.id) AS degree
		FROM graph_nodes n WHERE visibility = 'usable_by_ai' AND type IN (\(marks))
		ORDER BY degree DESC, updated_at DESC LIMIT ?
		""", arguments: StatementArguments(arguments))
		let truncated = rows.count > limit
		var nodesOut: [JSONValue] = []
		var typeByID: [String: String] = [:]
		var idList: [String] = []
		for row in rows.prefix(limit) {
			let node = GraphNode(row: row)
			guard isVisible(node) else { continue }
			var object: [String: JSONValue] = [
				"id": .string(node.id), "type": .string(node.type), "label": .string(node.label),
				"degree": .number(Double(row["degree"] as Int)), "updatedAt": .string(node.updatedAt),
			]
			for key in ["text", "summary", "description", "email"] {
				if let value = node.props[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
					object["detail"] = .string(String(value.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(280)))
					break
				}
			}
			nodesOut.append(.object(object))
			typeByID[node.id] = node.type
			idList.append(node.id)
		}
		let ids = Set(idList)
		var edgesOut: [JSONValue] = []
		var linked = Set<String>()
		func pairKey(_ a: String, _ b: String) -> String { a < b ? "\(a)|\(b)" : "\(b)|\(a)" }
		for start in stride(from: 0, to: idList.count, by: 400) {
			let chunk = Array(idList[start ..< min(start + 400, idList.count)])
			let chunkMarks = Array(repeating: "?", count: chunk.count).joined(separator: ",")
			for row in try Row.fetchAll(db, sql: "SELECT \(edgeColumns) FROM graph_edges WHERE src IN (\(chunkMarks)) ORDER BY weight DESC", arguments: StatementArguments(chunk)) {
				let edge = GraphEdge(row: row)
				guard ids.contains(edge.dst), edgesOut.count < 4000 else { continue }
				linked.insert(pairKey(edge.src, edge.dst))
				var object: [String: JSONValue] = [
					"id": .string(edge.id), "src": .string(edge.src), "dst": .string(edge.dst), "type": .string(edge.type),
					"weight": .number(edge.weight), "confidence": .number(edge.confidence), "origin": .string(edge.origin),
					"occurrences": .number(Double(edge.occurrences)),
				]
				if let reason = edge.reason, !reason.isEmpty { object["reason"] = .string(reason) }
				edgesOut.append(.object(object))
			}
		}
		if collapseObservations, !types.contains("observation"), !idList.isEmpty {
			edgesOut += try sharedActivityEdges(db, ids: idList, typeByID: typeByID, linked: linked, budget: 4000 - edgesOut.count)
		}
		let totals = try counts(db)
		return [
			"nodes": .array(nodesOut), "edges": .array(edgesOut),
			"totals": ["nodes": .number(Double(totals.nodes)), "edges": .number(Double(totals.edges))],
			"truncated": .bool(truncated),
		]
	}

	static func sharedActivityEdges(_ db: Database, ids: [String], typeByID: [String: String], linked: Set<String>, budget: Int) throws -> [JSONValue] {
		guard budget > 0 else { return [] }
		var members: [String: Set<String>] = [:]
		for start in stride(from: 0, to: ids.count, by: 400) {
			let chunk = Array(ids[start ..< min(start + 400, ids.count)])
			let marks = Array(repeating: "?", count: chunk.count).joined(separator: ",")
			let rows = try Row.fetchAll(db, sql: """
			SELECT e.src AS member, e.dst AS obs FROM graph_edges e JOIN graph_nodes o ON o.id = e.dst
			  WHERE e.src IN (\(marks)) AND o.type = 'observation' AND o.visibility = 'usable_by_ai'
			UNION ALL
			SELECT e.dst AS member, e.src AS obs FROM graph_edges e JOIN graph_nodes o ON o.id = e.src
			  WHERE e.dst IN (\(marks)) AND o.type = 'observation' AND o.visibility = 'usable_by_ai'
			""", arguments: StatementArguments(chunk + chunk))
			for row in rows { members[row["obs"], default: []].insert(row["member"]) }
		}
		var counts: [String: Int] = [:]
		func pairKey(_ a: String, _ b: String) -> String { a < b ? "\(a)|\(b)" : "\(b)|\(a)" }
		func bump(_ a: String, _ b: String) {
			guard a != b else { return }
			let key = pairKey(a, b)
			guard !linked.contains(key) else { return }
			counts[key, default: 0] += 1
		}
		for set in members.values where set.count >= 2 {
			let list = set.sorted()
			let threads = list.filter { typeByID[$0] == "thread" }
			if !threads.isEmpty {
				for thread in threads { for other in list where other != thread { bump(thread, other) } }
			} else if list.count <= 8 {
				for i in 0 ..< list.count { for j in (i + 1) ..< list.count { bump(list[i], list[j]) } }
			}
		}
		return counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.prefix(budget).map { key, count in
			let parts = key.split(separator: "|").map(String.init)
			return [
				"id": .string("shared:\(key)"), "src": .string(parts[0]), "dst": .string(parts[1]), "type": "shared_activity",
				"weight": .number(min(1, log2(1 + Double(count)) / 4)), "confidence": 1, "origin": "derived",
				"occurrences": .number(Double(count)),
			]
		}
	}

	// MARK: Memory mirroring (port of `graph/memory-hooks.ts`)

	static func memoryNodeInput(_ item: MemoryRecord) -> GraphNodeInput {
		let subject = item.subject?.trimmingCharacters(in: .whitespacesAndNewlines)
		let fallback = String(item.value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
		return GraphNodeInput(
			type: "memory",
			key: item.id,
			label: (subject?.isEmpty == false ? subject : nil) ?? fallback,
			props: [
				"memoryType": .string(item.type),
				"text": .string(String(item.value.prefix(1000))),
				"subject": subject.map(JSONValue.string) ?? .null,
				"expiresAt": item.expiresAt.map(JSONValue.string) ?? .null,
			],
			sensitivity: item.sensitivity,
			visibility: item.visibility,
			ref: ("memory_items", item.id),
		)
	}

	/// Remove a memory's activity-ledger observation and what derived from it.
	static func removeMemoryObservation(_ db: Database, memoryID: String) throws {
		guard let row = try Row.fetchOne(db, sql: "SELECT id, node_id FROM observations WHERE source_id = 'memory' AND external_id = ?", arguments: [memoryID]) else { return }
		let nodeID: String = row["node_id"]
		let former = try removeEdgesTouching(db, nodeID: nodeID)
		try deleteNode(db, id: nodeID)
		try db.execute(sql: "DELETE FROM observations WHERE id = ?", arguments: [row["id"] as String])
		try pruneOrphanEntities(db, former)
	}

	/// Mirror a saved/updated memory; queue enrichment when its text changed.
	static func syncMemoryNode(_ db: Database, _ item: MemoryRecord, textChanged: Bool) throws {
		let node = memoryNodeInput(item)
		let subject = item.subject?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let usable = item.visibility == "usable_by_ai"
		let existing = try findNode(db, type: "memory", key: item.id)
		if !usable || textChanged || existing?.props["expiresAt"] != (item.expiresAt.map(JSONValue.string) ?? .null) {
			try removeMemoryObservation(db, memoryID: item.id)
		}
		if let existing {
			let former = usable
				? try removeEdgesTouching(db, nodeID: existing.id, origin: "deterministic", type: "about")
				: try removeEdgesTouching(db, nodeID: existing.id)
			try pruneOrphanEntities(db, former)
		}
		let edges = usable && !subject.isEmpty
			? [GraphEdgeInput(src: node, dst: GraphNodeInput(type: "person", key: entityNameKey(subject), label: subject), type: "about")]
			: []
		try write(db, nodes: [node], edges: edges, enrich: textChanged && usable ? ["embed", "extract"] : [])
	}

	static func removeMemoryNode(_ db: Database, memoryID: String) throws {
		try removeMemoryObservation(db, memoryID: memoryID)
		if let node = try findNode(db, type: "memory", key: memoryID) { try deleteNode(db, id: node.id) }
	}
}

/// Read-side graph access for the app (keeps GRDB out of the UI target).
public final class GraphService: Sendable {
	let writer: any DatabaseWriter

	public init(writer: any DatabaseWriter) {
		self.writer = writer
	}

	/// `/api/graph` snapshot.
	public func snapshot(types: [String]?, limit: Int?, collapseObservations: Bool = true) throws -> JSONValue {
		let valid = types?.filter { GraphStore.nodeTypes.contains($0) }
		return try writer.read { db in try GraphStore.snapshot(db, types: valid, limit: limit, collapseObservations: collapseObservations) }
	}

	/// Neighborhood of an entity found by label (or email), for chat tools.
	public func neighborhood(of entity: String, depth: Int = 2, limit: Int = 50) throws -> JSONValue {
		try writer.read { db in
			let trimmed = entity.trimmingCharacters(in: .whitespacesAndNewlines)
			var matches: [GraphNode] = []
			if trimmed.contains("@"), let direct = try GraphStore.findNode(db, type: "person", key: GraphStore.emailPersonKey(trimmed)) {
				matches = [direct]
			} else {
				matches = try GraphStore.searchNodesByLabel(db, query: trimmed, limit: 10)
			}
			guard !matches.isEmpty else { return ["entity": .string(trimmed), "neighbors": [], "message": "No matching graph entity found."] }
			let exact = matches.filter { $0.label.lowercased() == trimmed.lowercased() }
			let candidates = exact.isEmpty ? matches : exact
			if candidates.count > 1 {
				return ["entity": .string(trimmed), "candidates": .array(candidates.map { ["id": .string($0.id), "type": .string($0.type), "label": .string($0.label)] })]
			}
			let node = candidates[0]
			return [
				"entity": ["id": .string(node.id), "type": .string(node.type), "label": .string(node.label)],
				"neighbors": .array(try GraphStore.neighbors(db, from: [node.id], depth: depth, limit: limit).map(\.json)),
			]
		}
	}
}
