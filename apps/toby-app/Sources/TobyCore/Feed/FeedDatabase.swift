import Foundation
import GRDB
import TobyAI

/// The ranked result can be replaced independently of the decisions that govern visibility.
struct FeedDatabase: Sendable {
	static let restoredHomeMarker = ".feed-database-restored"
	let writer: any DatabaseWriter

	init(writer: any DatabaseWriter, home: URL) throws {
		self.writer = writer
		try writer.write { db in
			guard try Self.value("settings", db) == nil else { return }
			if FileManager.default.fileExists(atPath: home.appending(path: Self.restoredHomeMarker).path) {
				try Self.set("settings", [:], db)
				return
			}
			let stateURL = home.appending(path: "dashboard-feed-state.json")
			var settings: [String: JSONValue] = [:]
			if FileManager.default.fileExists(atPath: stateURL.path) {
				settings = try JSONDecoder().decode([String: JSONValue].self, from: Data(contentsOf: stateURL))
			}
			let cacheURL = home.appending(path: "dashboard-feed.json")
			let ranked = (try? Data(contentsOf: cacheURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
			let cards = (ranked?["content"]?["items"]?.arrayValue ?? []) + (ranked?["recentItems"]?.arrayValue ?? []).compactMap { $0["item"] }
			for card in cards {
				guard let id = card["id"]?.stringValue, let at = settings["notified"]?[id] else { continue }
				let facts = Self.legacyFacts(card)
				let notification: JSONValue = ["at": at, "legacyItem": facts]
				try db.execute(sql: "INSERT OR IGNORE INTO feed_members VALUES (?, ?, ?)", arguments: ["legacy-notified:" + id, id, notification.jsonString()])
			}
			if let raw = settings.removeValue(forKey: "items") {
				guard let entries = raw.objectValue else { throw TodoError.invalid("Could not import Feed decisions.") }
				for (id, decision) in entries {
					guard var fields = decision.objectValue, decision["kind"]?.stringValue != nil,
					      decision["at"]?.stringValue.flatMap(TodoRecurrence.parseISO) != nil else {
						throw TodoError.invalid("Could not import a saved Feed decision.")
					}
					if let card = cards.first(where: { $0["id"]?.stringValue == id }) {
						fields["legacyItem"] = Self.legacyFacts(card)
					}
					try Self.record(id, .object(fields), db)
				}
			}
			try Self.set("settings", .object(settings), db)
			if let ranked {
				try Self.set("ranking", ranked, db)
			}
		}
	}

	private static func legacyFacts(_ card: JSONValue) -> JSONValue {
		.object((card.objectValue ?? [:]).filter { ["title", "subtitle", "timestamp"].contains($0.key) })
	}

	static func value(_ key: String, _ db: Database) throws -> JSONValue? {
		try String.fetchOne(db, sql: "SELECT value FROM feed_metadata WHERE key = ?", arguments: [key]).map { try JSONValue(parsing: $0) }
	}

	static func set(_ key: String, _ value: JSONValue, _ db: Database) throws {
		try db.execute(sql: "INSERT OR REPLACE INTO feed_metadata VALUES (?, ?)", arguments: [key, value.jsonString()])
	}

	static func record(_ id: String, _ decision: JSONValue, _ db: Database) throws {
		try db.execute(sql: "INSERT OR REPLACE INTO feed_decisions VALUES (?, ?)", arguments: [id, decision.jsonString()])
	}

	func state() throws -> [String: JSONValue] {
		try writer.read { db in
			var state = try Self.value("settings", db)?.objectValue ?? [:]
			var items: [String: JSONValue] = [:]
			for row in try Row.fetchAll(db, sql: "SELECT item_id, decision FROM feed_decisions") {
				items[row["item_id"]] = try JSONValue(parsing: row["decision"])
			}
			var coverage: [String: [JSONValue]] = [:]
			for row in try Row.fetchAll(db, sql: """
				SELECT m.card_id, m.activity, d.decision FROM feed_members m
				JOIN feed_decisions d ON d.item_id = m.identity WHERE m.activity IS NOT NULL
				""") {
				coverage[row["card_id"], default: []].append(["decision": try JSONValue(parsing: row["decision"]), "activity": try JSONValue(parsing: row["activity"])])
			}
			state["coverage"] = .object(coverage.mapValues(JSONValue.array))
			state["items"] = .object(items)
			return state
		}
	}

	func claimNotification(_ key: String, target: String, at: Date) throws -> Bool {
		try writer.write { db in
			var state = try Self.value("settings", db)?.objectValue ?? [:]
			var notified = state["notified"]?.objectValue ?? [:]
			guard notified[key] == nil, notified[target] == nil else { return false }
			notified[key] = .string(TodoRecurrence.isoString(at))
			state["notified"] = .object(notified)
			try Self.set("settings", .object(state), db)
			return true
		}
	}

	func decision(_ id: String) throws -> JSONValue? {
		try writer.read { db in
			try String.fetchOne(db, sql: "SELECT decision FROM feed_decisions WHERE item_id = ?", arguments: [id]).map { try JSONValue(parsing: $0) }
		}
	}

	func pendingActions() throws -> [(String, JSONValue)] {
		try writer.read { db in
			try Row.fetchAll(db, sql: "SELECT item_id, decision FROM feed_decisions WHERE json_extract(decision, '$.kind') = 'pending'").map {
				($0["item_id"], try JSONValue(parsing: $0["decision"]))
			}
		}
	}

	func updateSettings(decision: (String, JSONValue)? = nil, _ body: (inout [String: JSONValue]) -> Void) throws -> [String: JSONValue] {
		try writer.write { db in
			var state = try Self.value("settings", db)?.objectValue ?? [:]
			if let (id, entry) = decision { try Self.record(id, entry, db) }
			body(&state)
			try Self.set("settings", .object(state), db)
			return state
		}
	}
}

extension FeedDatabase {
	/// Connect each incoming message and its ancestors before choosing the newest
	/// representative. An ancestor can arrive after its replies.
	func reconcile(_ candidates: [FeedCandidate]) throws -> [FeedCandidate] {
		try writer.write { db in
			var items = candidates.filter { !$0.itemID.isEmpty }
			for index in items.indices {
				let candidate = items[index]
				guard let identity = candidate.identity else { continue }
				if candidate.category != "email" {
					let scoped = FeedText.sha(identity.jsonString())
					if candidate.category == "calendar", identity["record"]?.stringValue?.nilIfEmpty != nil {
						items[index].id = FeedCandidate.makeID(category: candidate.category, provider: candidate.providerName, itemID: scoped)
					} else {
						items[index].id += ":" + scoped
					}
					if candidate.providerName == "applereminders" {
						try Self.reconcileReminder(candidate, target: items[index].id, identity: identity, db)
					}
					try Self.adoptLegacy(candidate, as: items[index].id, db)
					continue
				}
				try Self.reconcileMail(&items[index], identity: identity, db)
			}
			for index in items.indices {
				let target = items[index].id
				try db.execute(sql: "INSERT OR IGNORE INTO feed_members(identity, card_id) VALUES (?, ?)", arguments: [target, target])
				items[index].cardID = try Self.card(target, db)
			}
			return items
		}
	}

	private static func reconcileMail(_ input: inout FeedCandidate, identity: JSONValue, _ db: Database) throws {
		var candidate = input
		guard let account = identity["account"]?.stringValue,
		      let uid = identity["uid"]?.intValue else { return }
		let generation = identity["generation"]?.intValue ?? 0
		let message = identity["message"]?.stringValue ?? "uid:\(generation):\(uid)"
		let ancestors = identity["ancestors"]?.arrayValue?.compactMap(\.stringValue) ?? []
		let aliases = (ancestors + [message]).map { "mail:" + FeedText.sha(account + "\n" + $0) }
		guard let preferred = aliases.first else { return }
		let card = try Self.card(preferred, db) ?? preferred
		for alias in Set(aliases) {
			if let existing = try Self.card(alias, db), existing != card {
				try db.execute(sql: "UPDATE feed_members SET card_id = ? WHERE card_id = ?", arguments: [card, existing])
			}
			try db.execute(sql: "INSERT OR IGNORE INTO feed_members(identity, card_id) VALUES (?, ?)", arguments: [alias, card])
		}
		// Keep the first delivery of a known Message-ID. Copying that message
		// back into the inbox can give it a newer UID without creating a reply.
		let messageAlias = "mail:" + FeedText.sha(account + "\n" + message)
		let prior = try String.fetchOne(db, sql: "SELECT activity FROM feed_members WHERE identity = ?", arguments: [messageAlias])
		let boundary: JSONValue = ["uid": .number(Double(uid)), "generation": identity["generation"] ?? .null, "received": identity["received"] ?? .null]
		var delivery = try prior.map { try JSONValue(parsing: $0) } ?? boundary
		if delivery["generation"] == identity["generation"], uid < (delivery["uid"]?.intValue ?? uid) { delivery = boundary }
		if prior != delivery.jsonString() {
			try db.execute(sql: "UPDATE feed_members SET activity = ? WHERE identity = ?", arguments: [delivery.jsonString(), messageAlias])
		}
		var details = identity.objectValue ?? [:]
		details["firstDelivery"] = delivery
		candidate.identity = .object(details)
		let target = candidate.id + ":" + FeedText.sha([account, String(generation), message].joined(separator: "\n"))
		let original = candidate
		candidate.id = target
		try db.execute(sql: """
			INSERT OR REPLACE INTO feed_members(identity, card_id, activity) VALUES (?, ?, ?)
			""", arguments: [target, card, identity.jsonString()])
		try Self.adoptLegacy(original, as: target, db)
		input = candidate
	}

	/// EventKit exposes a due date for repeating reminders, but a user can edit
	/// the date on the same occurrence. Advance a reused reminder ID only when
	/// we have evidence that its preceding occurrence was completed.
	private static func reconcileReminder(_ candidate: FeedCandidate, target: String, identity: JSONValue, _ db: Database) throws {
		guard let scope = identity["scope"]?.stringValue, identity["occurrence"]?.stringValue != nil,
		      try Self.card(target, db) == nil else { return }
		let series = "reminder:" + FeedText.sha(scope + "\n" + candidate.itemID)
		var card = target
		if let previous = try Self.card(series, db) {
			let completed = try Bool.fetchOne(db, sql: """
				SELECT EXISTS(SELECT 1 FROM feed_members m JOIN feed_decisions d ON m.identity = d.item_id
				WHERE m.card_id = ? AND json_extract(d.decision, '$.action') = 'task.complete'
				AND json_extract(d.decision, '$.kind') = 'done')
				""", arguments: [previous]) ?? false
			if !completed { card = previous }
		}
		try db.execute(sql: "INSERT OR REPLACE INTO feed_members(identity, card_id) VALUES (?, ?)", arguments: [series, card])
		try db.execute(sql: "INSERT INTO feed_members(identity, card_id, activity) VALUES (?, ?, ?)", arguments: [target, card, identity.jsonString()])
	}

	static func representatives(_ candidates: [FeedCandidate]) -> [FeedCandidate] {
		var indexes: [String: Int] = [:]
		var result: [FeedCandidate] = []
		for item in candidates {
			let card = item.cardID ?? item.id
			if let index = indexes[card] {
				let delivery = item.identity?["firstDelivery"]
				let previous = result[index].identity?["firstDelivery"]
				let newer: Bool
				if delivery?["generation"] == previous?["generation"] {
					newer = (delivery?["uid"]?.intValue ?? 0) > (previous?["uid"]?.intValue ?? 0)
				} else {
					newer = (delivery?["received"]?.stringValue ?? "") > (previous?["received"]?.stringValue ?? "")
				}
				if newer { result[index] = item }
			} else {
				indexes[card] = result.count
				result.append(item)
			}
		}
		return result
	}

	private static func card(_ id: String, _ db: Database) throws -> String? {
		try String.fetchOne(db, sql: "SELECT card_id FROM feed_members WHERE identity = ?", arguments: [id])
	}

	/// Old IDs lack account and occurrence information. Match archived card facts
	/// before binding a legacy decision to a newly scoped identity.
	private static func adoptLegacy(_ candidate: FeedCandidate, as target: String, _ db: Database) throws {
		func matches(_ record: JSONValue) -> Bool {
			let old = record["legacyItem"]
			let matchesSnapshot = old?["title"]?.stringValue == candidate.title
				&& old?["subtitle"]?.stringValue == candidate.subtitle
				&& old?["timestamp"]?.stringValue == candidate.timestamp
			let nativeRecord = ["applecalendar", "applereminders"].contains(candidate.providerName)
			let singleOccurrence = candidate.identity?["occurrence"]?.stringValue?.nilIfEmpty == nil
			return matchesSnapshot || (nativeRecord && singleOccurrence)
		}
		if let raw = try String.fetchOne(db, sql: "SELECT decision FROM feed_decisions WHERE item_id = ?", arguments: [candidate.id]),
		   try matches(JSONValue(parsing: raw)) {
			try db.execute(sql: "UPDATE OR IGNORE feed_decisions SET item_id = ? WHERE item_id = ?", arguments: [target, candidate.id])
		}
		let alias = "legacy-notified:" + candidate.id
		if let raw = try String.fetchOne(db, sql: "SELECT activity FROM feed_members WHERE identity = ?", arguments: [alias]) {
			let record = try JSONValue(parsing: raw)
			guard matches(record) else { return }
			var settings = try Self.value("settings", db)?.objectValue ?? [:]
			var notified = settings["notified"]?.objectValue ?? [:]
			let key: String
			if let account = candidate.identity?["account"]?.stringValue, let message = candidate.identity?["message"]?.stringValue {
				key = "mail:" + FeedText.sha(account + "\n" + message)
			} else { key = target }
			notified[key] = record["at"]
			settings["notified"] = .object(notified)
			try Self.set("settings", .object(settings), db)
			try db.execute(sql: "DELETE FROM feed_members WHERE identity = ?", arguments: [alias])
		}
	}

	static func covered(_ identity: JSONValue?, card: String?, state: [String: JSONValue], now: Date) -> Bool {
		guard let identity, let card else { return false }
		for row in state["coverage"]?[card]?.arrayValue ?? [] {
			let decision = row["decision"]
			if decision?["kind"] == "snoozed" {
				if (decision?["until"]?.stringValue.flatMap(TodoRecurrence.parseISO) ?? .distantPast) > now { return true }
				continue
			}
			if identity["occurrence"] != nil { return true }
			let delivery = identity["firstDelivery"] ?? identity
			let handled = row["activity"]
			if let message = identity["message"]?.stringValue, message == handled?["message"]?.stringValue { return true }
			if delivery["generation"] == handled?["generation"] {
				if (delivery["uid"]?.intValue ?? 0) <= (handled?["uid"]?.intValue ?? 0) { return true }
			} else {
				guard let received = delivery["received"]?.stringValue, let at = decision?["at"]?.stringValue else { return true }
				if received <= at { return true }
			}
		}
		return false
	}
}
