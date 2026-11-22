import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyMail
import TobyStore

/// Returns scripted observations.
struct StaticSource: ObservationSource {
	var id: String
	var observations: [ObservationInput]
	var selfEmails: [String] = []
	var displayName: String { id }
	var defaultEnabled: Bool { true }
	var evidenceOnly: Bool { false }
	func collect(since: String, limit: Int) async throws -> ActivityResult {
		ActivityResult(observations: observations.filter { $0.occurredAt >= since }, selfEmails: selfEmails)
	}
}

struct FixedEmbedder: TextEmbedder {
	var modelID: String { "test-embed" }
	func embed(_ texts: [String]) async throws -> [[Float]] { texts.map { $0.contains("deck") ? [1, 0, 0] : [0, 1, 0] } }
}

final class EvalLog: @unchecked Sendable {
	let lock = NSLock()
	var prompts: [JSONValue] = []
	func add(_ prompt: String) { lock.withLock { prompts.append((try? JSONDecoder().decode(JSONValue.self, from: Data(prompt.utf8))) ?? .null) } }
	var units: [JSONValue] { lock.withLock { prompts.flatMap { $0["units"]?.arrayValue ?? [] } } }
}

@Suite("Observations and follow-ups")
struct FollowupTests {
	let home: URL
	let database: TobyDatabase
	let todos: TodoService

	init() throws {
		home = try temporaryHome()
		database = try TobyDatabase.inMemory()
		todos = TodoService(writer: database.writer, tobyDirectory: home)
	}

	static func email(_ id: String, from: String, to: String, at: String, title: String, excerpt: String, thread: String = "t1", seen: Bool = false) -> ObservationInput {
		ObservationInput(externalID: id, kind: "email.message", threadID: thread, occurredAt: at, title: title, excerpt: excerpt,
		                 actors: [["role": "from", "email": .string(from), "name": "Dana"], ["role": "to", "email": .string(to)]],
		                 facts: ["bulk": false, "seen": .bool(seen), "mailbox": "INBOX"])
	}

	@Test func contentHashIgnoresVolatileFactsAndIngestLinksTheGraph() async throws {
		let first = Self.email("m1", from: "dana@x.com", to: "me@y.com", at: "2026-11-20T10:00:00.000Z", title: "Deck review", excerpt: "Can you review the deck?")
		var readCopy = first
		readCopy.facts["seen"] = true
		let read = readCopy
		#expect(ObservationLedger.contentHash(first) == ObservationLedger.contentHash(read))
		let statuses = try await database.writer.write { db in
			[try ObservationLedger.ingest(db, source: "plugin:email", raw: first, emails: ["me@y.com"], handles: []),
			 try ObservationLedger.ingest(db, source: "plugin:email", raw: read, emails: ["me@y.com"], handles: [])]
		}
		#expect(statuses == [.new, .unchanged])
		let (observation, types, selfProps, steps) = try await database.writer.read { db in
			let nodeID = try String.fetchOne(db, sql: "SELECT node_id FROM observations") ?? ""
			return (try ObservationLedger.byNode(db, nodeID), Set(try String.fetchAll(db, sql: "SELECT type FROM graph_edges")),
			        try String.fetchOne(db, sql: "SELECT props_json FROM graph_nodes WHERE key = 'email:me@y.com'"), try String.fetchOne(db, sql: "SELECT steps_json FROM graph_enrich_queue"))
		}
		#expect(observation?.direction == "inbound")
		#expect(observation?.threadKey == "plugin:email:t1")
		#expect(types == ["sent", "received", "in_thread"])
		#expect(selfProps?.contains(#""self":true"#) == true)
		#expect(steps == #"["embed","extract"]"#)
	}

	@Test func sourceIngestPagesAndKeepsAnOverlappingCursor() async throws {
		let now = TodoRecurrence.parseISO("2026-11-21T12:00:00.000Z")!
		let source = StaticSource(id: "plugin:email", observations: [Self.email("m1", from: "dana@x.com", to: "me@y.com", at: "2026-11-20T10:00:00.000Z", title: "Hi", excerpt: "x")], selfEmails: ["Me@Y.com"])
		let stats = await ObservationLedger.ingest(source: source, writer: database.writer, now: now)
		#expect(stats.created == 1)
		let cursor = try await database.writer.read { db in try Row.fetchOne(db, sql: "SELECT since, self_json FROM observation_cursors").map { ($0["since"] as String, $0["self_json"] as String) } }
		#expect(cursor?.0 == "2026-11-21T11:00:00.000Z")
		#expect(cursor?.1.contains("me@y.com") == true)
		#expect(await ObservationLedger.ingest(source: source, writer: database.writer, now: now).created == 0)
	}

	@Test func enrichmentEmbedsLinksAndExtractsEntities() async throws {
		try await database.writer.write { db in
			try ObservationLedger.ingest(db, source: "plugin:email", raw: Self.email("m1", from: "dana@x.com", to: "me@y.com", at: TodoRecurrence.isoString(Date()), title: "Deck", excerpt: "the deck draft", thread: "a"), emails: [], handles: [])
			try ObservationLedger.ingest(db, source: "plugin:email", raw: Self.email("m2", from: "bo@x.com", to: "me@y.com", at: TodoRecurrence.isoString(Date()), title: "More deck", excerpt: "deck v2", thread: "b"), emails: [], handles: [])
		}
		let stats = try await GraphEnrichment.run(writer: database.writer, embedder: FixedEmbedder(), extract: { nodes in
			["entities": [], "links": [["nodeId": .string(nodes[0].id), "edgeType": "about", "entity": ["type": "project", "name": "Q1 Deck", "confidence": 0.9]]]]
		})
		#expect(stats.embedded == 2)
		#expect(stats.semanticEdges >= 1)
		#expect(stats.extracted == 1)
		let (related, label, queued) = try await database.writer.read { db in
			(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM graph_edges WHERE type = 'related_to' AND origin = 'semantic'") ?? 0,
			 try String.fetchOne(db, sql: "SELECT label FROM graph_nodes WHERE key = 'name:q1 deck'"), try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM graph_enrich_queue") ?? -1)
		}
		#expect(related >= 1)
		#expect(label == "Q1 Deck")
		#expect(queued == 0)
	}

	func service(_ sources: [any ObservationSource], log: EvalLog, reply: @escaping @Sendable ([JSONValue]) -> JSONValue) -> FollowupService {
		FollowupService(writer: database.writer, todos: todos, sources: sources, evaluate: { prompt, system in
			#expect(system.contains("follow-up evaluator"))
			log.add(prompt)
			let units = ((try? JSONDecoder().decode(JSONValue.self, from: Data(prompt.utf8)))?["units"]?.arrayValue) ?? []
			return reply(units)
		}, extract: nil)
	}

	@Test func opensAFollowupTodoThenAutoCompletesItFromNewEvidence() async throws {
		let now = Date()
		let ask = Self.email("m1", from: "dana@x.com", to: "me@y.com", at: TodoRecurrence.isoString(now.addingTimeInterval(-3600)), title: "Deck review", excerpt: "Can you review the deck by Friday?")
		let log = EvalLog()
		let source = StaticSource(id: "plugin:email", observations: [ask], selfEmails: ["me@y.com"])
		let first = service([source], log: log) { units in
			["units": .array(units.map { unit in
				["unitId": unit["unitId"] ?? "", "close": [],
				 "open": [["kind": "owe_reply", "title": "Review Dana's deck", "counterpart": "Dana", "confidence": 0.9, "evidenceIds": unit["nodeIds"] ?? []]]]
			})]
		}
		let stats = await first.runOnce(now: now)
		#expect(stats.status == "ok", "\(stats.error ?? "")")
		#expect(stats.opened == 1)
		let open = try todos.list(["status": "open"])["todos"]?.arrayValue ?? []
		let todo = try #require(open.first { $0["title"] == "Review Dana's deck" })
		let todoID = try #require(todo["id"]?.stringValue)
		#expect(todoID.hasPrefix("toby-followup-"))
		let lists = try todos.organization("list")
		#expect(lists.contains { $0["name"] == "From Toby" && $0["id"] == todo["listId"] })
		#expect((log.units.first?["evidence"]?.stringValue ?? "").contains("Can you review the deck"))

		// Re-running (the new loop changes the unit, as in the daemon) never duplicates.
		#expect(await first.runOnce(now: now.addingTimeInterval(60)).opened == 0)
		let evaluations = log.units.count
		#expect(await first.runOnce(now: now.addingTimeInterval(90)).evaluated == 0, "unchanged units are not re-evaluated")
		#expect(log.units.count == evaluations)
		#expect((try todos.list(["status": "open"])["todos"]?.arrayValue ?? []).filter { $0["title"] == "Review Dana's deck" }.count == 1)

		// The user's reply closes the loop and completes the todo.
		let reply = ObservationInput(externalID: "m2", kind: "email.message", threadID: "t1", occurredAt: TodoRecurrence.isoString(now.addingTimeInterval(-60)),
		                             title: "Re: Deck review", excerpt: "Reviewed — looks good.", actors: [["role": "from", "email": "me@y.com"], ["role": "to", "email": "dana@x.com"]])
		let closing = service([StaticSource(id: "plugin:email", observations: [ask, reply], selfEmails: ["me@y.com"])], log: log) { units in
			["units": .array(units.map { unit in
				let loops = unit["loopIds"]?.arrayValue ?? []
				let evidence = unit["nodeIds"]?.arrayValue?.last ?? ""
				return ["unitId": unit["unitId"] ?? "", "open": [], "close": .array(loops.map { ["loopId": $0, "confidence": 0.95, "evidenceId": evidence, "reason": "User replied"] })]
			})]
		}
		let closed = await closing.runOnce(now: now.addingTimeInterval(120))
		#expect(closed.closed == 1, "\(closed)")
		#expect(try todos.get(todoID)["state"]?["status"] == "completed")
		let detail = try #require(try await closing.detail(todoID))
		#expect(detail["status"] == "resolved")
		#expect((detail["evidence"]?.arrayValue ?? []).count == 2)

		// Reopening marks the resolution rejected.
		#expect(try await closing.reopen(todoID)?["resolutionRejected"] == true)
		#expect(try todos.get(todoID)["state"]?["status"] == "open")
		#expect(try await closing.notUseful(id: todoID))
		#expect(try todos.get(todoID)["deleted"] == true)
	}

	@Test func bulkMailNeverOpensAndInstructionsAreValidated() async throws {
		var newsletter = Self.email("n1", from: "news@shop.com", to: "me@y.com", at: TodoRecurrence.isoString(Date()), title: "Sale", excerpt: "50% off")
		newsletter.facts["bulk"] = true
		let log = EvalLog()
		let followups = service([StaticSource(id: "plugin:email", observations: [newsletter])], log: log) { _ in ["units": []] }
		let stats = await followups.runOnce()
		#expect(stats.candidates == 0)
		#expect(log.units.isEmpty)
		await #expect(throws: TodoError.self) { try await followups.saveInstruction(id: nil, text: "   ") }
		_ = try await followups.saveInstruction(id: nil, text: "Ignore anything from my landlord")
		#expect(try await followups.instructions().arrayValue?.count == 1)
		let notReady = FollowupService(writer: database.writer, todos: todos, sources: [], evaluate: { _, _ in [:] }, extract: nil, ready: { false })
		#expect(await notReady.runOnce().status == "setup_required")
	}

	@Test func mailActivityReadsInboxAndSentReadOnly() async throws {
		let server = FakeIMAPServer(boxes: [
			"INBOX": [.init(uid: 4, flags: [], from: ("Dana", "dana@x.com"), to: "me@x.com", subject: "Deck", date: "Fri, 20 Nov 2026 10:00:00 +0000", body: "Can you review?\n\nOn Thu, Bo wrote:\n> old")],
			"Sent": [.init(uid: 9, flags: ["\\Seen"], from: (nil, "me@x.com"), to: "dana@x.com", subject: "Re: Deck", date: "Fri, 20 Nov 2026 11:00:00 +0000", body: "Done")],
		], special: ["Sent": "\\Sent"])
		let secrets = InMemorySecretStore()
		let mail = MailService(writer: database.writer, secrets: secrets) { _, _, _ in server.stream() }
		try await mail.connect(MailServiceTests.account)
		let result = try await mail.recentActivity(since: "2026-11-19T00:00:00.000Z")
		#expect(result.observations.map(\.title) == ["Deck", "Re: Deck"])
		#expect(result.observations[0].excerpt == "Can you review?")
		#expect(result.observations[0].direction == "inbound")
		#expect(result.observations[1].direction == "outbound")
		#expect(result.observations[0].threadID == "4@x")
		#expect(result.observations[1].facts["seen"] == true)
		#expect(server.lock.withLock { server.commands }.contains { $0.hasPrefix("EXAMINE") })
		#expect(!server.lock.withLock { server.commands }.contains { $0.contains("STORE") })
	}

	@Test func slackActivityThreadsMentionsAndDirection() async throws {
		let fake = FakeSlackAPI([
			"auth.test": { _, _ in ["ok": true, "user_id": "UME"] },
			"search.messages": { params, _ in
				#expect(params["sort_dir"] == "asc")
				return ["ok": true, "messages": ["matches": [
					["ts": "1795000000.1", "user": "U2", "username": "ana", "team": "T1", "text": "<@UME> can you check?", "permalink": "https://x.slack.com/archives/C1/p1?thread_ts=1794999999.0", "channel": ["id": "C1", "name": "eng"]],
					["ts": "1795000005.1", "user": "UME", "text": "on it", "channel": ["id": "D1", "is_im": true]],
				]]]
			},
		])
		let slack = SlackService(api: SlackAPI(secrets: SlackTests.secrets(["authMethod": "oauth", "oauthUserToken": "xoxp"]), transport: fake))
		let result = try await slack.recentActivity(since: "2026-11-17T00:00:00.000Z")
		#expect(result.observations.count == 2)
		#expect(result.observations[0].threadID == "C1:1794999999.0")
		#expect(result.observations[0].title == "@you can you check?")
		#expect(result.observations[0].actors.contains { $0["role"] == "mentioned" && $0["handle"] == "UME" && $0["scope"] == "T1" })
		#expect(result.observations[1].direction == "outbound")
		#expect(result.observations[1].facts["isDm"] == true)
		#expect(result.selfHandles == ["UME"])
		#expect(fake.calls("search.messages").count == 3)
	}
}
