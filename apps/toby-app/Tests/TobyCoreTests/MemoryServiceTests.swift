import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Deterministic embedder: a bag-of-keywords vector over a fixed vocabulary.
struct FakeEmbedder: TextEmbedder {
	static let vocabulary = ["coffee", "tea", "morning", "meetings", "alice", "project", "atlas", "dark", "mode", "black"]
	let modelID = "test/embed"

	func embed(_ texts: [String]) async throws -> [[Float]] {
		texts.map { text in
			let words = Set(MemoryText.keywords(text))
			return Self.vocabulary.map { words.contains($0) ? 1 : 0.01 }
		}
	}
}

final class MemoryFixture {
	let database: TobyDatabase
	let service: MemoryService

	init(embedder: (any TextEmbedder)? = FakeEmbedder()) throws {
		database = try TobyDatabase.inMemory()
		let embed = embedder
		service = MemoryService(writer: database.writer) { embed }
	}

	func graphNode(type: String, key: String) throws -> GraphNode? {
		try database.writer.read { db in try GraphStore.findNode(db, type: type, key: key) }
	}
}

@Suite("Memory")
struct MemoryServiceTests {
	@Test func createsManualMemoryAndMirrorsItIntoTheGraph() async throws {
		let f = try MemoryFixture()
		let created = try await f.service.createManual(.init(type: "relationship", subject: "Alice", value: "Alice leads project Atlas"))
		let id = try #require(created["id"]?.stringValue)
		#expect(created["subject"] == "Alice")
		#expect(created["sourceIds"]?.arrayValue?.count == 1)
		#expect(created["embeddingModel"] == "test/embed")
		#expect(created["expiresAt"] == nil)

		let memoryNode = try #require(try f.graphNode(type: "memory", key: id))
		#expect(memoryNode.label == "Alice")
		let person = try #require(try f.graphNode(type: "person", key: "name:alice"))
		let neighbors = try await f.database.writer.read { db in try GraphStore.neighbors(db, from: [person.id]) }
		#expect(neighbors.map(\.node.id) == [memoryNode.id])
		let queued = try await f.database.writer.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM graph_enrich_queue") }
		#expect(queued == 1)
	}

	@Test func exactDuplicatesMergeInsteadOfInserting() async throws {
		let f = try MemoryFixture(embedder: nil)
		let first = try await f.service.createManual(.init(value: "Prefers   tea", confidence: 0.6))
		let second = try await f.service.createManual(.init(value: "prefers tea", confidence: 0.9))
		#expect(first["id"] == second["id"])
		#expect(second["confidence"] == 0.9)
		#expect(second["sourceIds"]?.arrayValue?.count == 2)
		#expect(try f.service.list().total == 1)
	}

	@Test func nearExactDuplicatesMergeAndKeepTheExistingValue() async throws {
		let f = try MemoryFixture()
		let first = try await f.service.createManual(.init(type: "preference", value: "Likes dark mode"))
		// Same vector under the fake embedder → near-exact (≥ 0.95): merge, keep value.
		let second = try await f.service.createManual(.init(type: "preference", value: "Likes dark mode in every app"))
		#expect(first["id"] == second["id"])
		#expect(second["value"] == "Likes dark mode")
		let explanation = try #require(try f.service.explain(first["id"]!.stringValue!))
		#expect(explanation["auditTrail"]?.arrayValue?.compactMap { $0["action"]?.stringValue } == ["saved", "merged"])
	}

	@Test func searchCombinesKeywordAndSemanticHits() async throws {
		let f = try MemoryFixture()
		_ = try await f.service.createManual(.init(type: "preference", value: "Drinks black coffee every morning"))
		_ = try await f.service.createManual(.init(type: "fact", value: "Has meetings on Tuesdays"))
		let results = try await f.service.search("coffee")
		#expect(results.first?["value"] == "Drinks black coffee every morning")
		#expect(try await f.service.search("   ").isEmpty)
	}

	@Test func updateRewritesHashGraphAndEmbedding() async throws {
		let f = try MemoryFixture()
		let id = try #require(try await f.service.createManual(.init(subject: "Alice", value: "Alice likes tea"))["id"]?.stringValue)
		let updated = try await f.service.update(id, .init(value: "Alice likes coffee", subject: "Bob", expiresAt: .some(nil)))
		#expect(updated["value"] == "Alice likes coffee")
		#expect(updated["subject"] == "Bob")
		#expect(try f.graphNode(type: "person", key: "name:alice") == nil)
		#expect(try f.graphNode(type: "person", key: "name:bob") != nil)
		let hash = try await f.database.writer.read { db in try String.fetchOne(db, sql: "SELECT content_hash FROM memory_items WHERE id = ?", arguments: [id]) }
		#expect(hash == MemoryText.contentHash("Alice likes coffee", subject: "Bob"))
	}

	@Test func forgetRemovesMemoryAndGraphNode() async throws {
		let f = try MemoryFixture()
		let id = try #require(try await f.service.createManual(.init(subject: "Alice", value: "Alice is on vacation"))["id"]?.stringValue)
		try f.service.forget(id)
		#expect(try f.service.get(id) == nil)
		#expect(try f.graphNode(type: "memory", key: id) == nil)
		// Like the daemon, forget leaves the subject entity for enrichment cleanup.
		#expect(try f.graphNode(type: "person", key: "name:alice") != nil)
		#expect(throws: TodoError.self) { try f.service.forget(id) }
	}

	@Test func proposalPolicyAutoSavesOnlySafeConfidentFacts() async throws {
		let f = try MemoryFixture(embedder: nil)
		let saved = try await f.service.propose(.init(type: "preference", value: "I prefer morning meetings", confidence: 0.85), system: "chat", reason: "stated")
		#expect(saved["status"] == "accepted")
		let held = try await f.service.propose(.init(type: "fact", value: "Takes medication for anxiety", confidence: 0.95), system: "chat", reason: "stated")
		#expect(held["status"] == "pending")
		#expect(held["sensitivity"] == "restricted")
		#expect(held["suggestedVisibility"] == "requires_confirmation")
		#expect(try f.service.list().total == 1)
	}

	@Test func retrievalExcludesPrivateMemories() async throws {
		let f = try MemoryFixture(embedder: nil)
		_ = try await f.service.createManual(.init(value: "Coffee order is a flat white"))
		_ = try await f.service.createManual(.init(value: "Coffee budget is secret", visibility: "private"))
		let bundle = try await f.service.retrieve(for: "what coffee should I order")
		#expect(bundle["memories"]?.arrayValue?.count == 1)
		#expect(bundle["omitted"]?["count"] == 1)
	}

	@Test func keywordsAndHashMatchTheDaemon() {
		// "what" is a stop word; punctuation splits words, as in the daemon.
		#expect(MemoryText.keywords("What's the plan for Project-Atlas, Alice?") == ["plan", "project", "atlas", "alice"])
		#expect(MemoryText.normalize(" Prefers   TEA ", subject: " Me ") == "me\nprefers tea")
		// Computed with the daemon's memoryContentHash.
		#expect(MemoryText.contentHash(" Prefers   TEA\n now ", subject: " Me ") == "80a553b9fc49fb14ae40c85d4e07752639de5a9075738cd2e5fd473654530949")
	}
}

@Suite("Graph")
struct GraphStoreTests {
	@Test func snapshotCollapsesSharedObservations() throws {
		let database = try TobyDatabase.inMemory()
		let json = try database.writer.write { db -> JSONValue in
			let alice = GraphNodeInput(type: "person", key: "email:alice@x.com", label: "Alice")
			let bob = GraphNodeInput(type: "person", key: "email:bob@x.com", label: "Bob")
			let email = GraphNodeInput(type: "observation", key: "obs1", label: "Lunch?", props: ["text": "Lunch on Friday?"])
			try GraphStore.write(db, nodes: [email], edges: [
				GraphEdgeInput(src: alice, dst: email, type: "sent"),
				GraphEdgeInput(src: email, dst: bob, type: "received"),
			])
			return try GraphStore.snapshot(db, types: ["person"])
		}
		#expect(json["nodes"]?.arrayValue?.count == 2)
		let edges = json["edges"]?.arrayValue ?? []
		#expect(edges.count == 1)
		#expect(edges.first?["type"] == "shared_activity")
		#expect(json["totals"]?["nodes"] == 3)
	}

	@Test func symmetricEdgesAreStoredOnceAndHiddenNodesBlockWalks() throws {
		let database = try TobyDatabase.inMemory()
		try database.writer.write { db in
			let a = GraphNodeInput(type: "topic", key: "a")
			let b = GraphNodeInput(type: "topic", key: "b")
			let secret = GraphNodeInput(type: "memory", key: "m", visibility: "private")
			let c = GraphNodeInput(type: "topic", key: "c")
			try GraphStore.write(db, edges: [
				GraphEdgeInput(src: a, dst: b, type: "related_to", weight: 0.4),
				GraphEdgeInput(src: b, dst: a, type: "related_to", weight: 0.9),
				GraphEdgeInput(src: a, dst: secret, type: "about"),
				GraphEdgeInput(src: secret, dst: c, type: "about"),
			])
			#expect(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM graph_edges WHERE type = 'related_to'") == 1)
			#expect(try Double.fetchOne(db, sql: "SELECT weight FROM graph_edges WHERE type = 'related_to'") == 0.9)
			let start = try GraphStore.findNode(db, type: "topic", key: "a")!
			let reached = try GraphStore.neighbors(db, from: [start.id], depth: 3).map(\.node.key)
			#expect(reached == ["b"])
		}
	}
}
