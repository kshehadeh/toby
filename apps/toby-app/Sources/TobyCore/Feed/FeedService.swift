import Foundation
import TobyAI

/// A built-in source of Feed items (replaces plugin dashboard tools).
public protocol FeedSource: Sendable {
	var category: String { get }
	var providerName: String { get }
	var providerDisplayName: String { get }
	var launchURL: String? { get }
	/// Standard item actions this source runs (`email.archiveItem`, `tasks.completeItem`, …).
	var itemActions: Set<String> { get }
	/// Summary in the dashboard shape (`{items: [{id, title, …}]}`).
	func summary(limit: Int) async throws -> JSONValue
	/// Run a standard item action; returns a user-facing message.
	func run(itemAction: String, itemID: String) async throws -> String
}

public struct CalendarFeedSource: FeedSource {
	let apple: AppleTools
	public init(apple: AppleTools) { self.apple = apple }
	public var category: String { "calendar" }
	public var providerName: String { "applecalendar" }
	public var providerDisplayName: String { "Calendar" }
	public var launchURL: String? { "ical://" }
	public var itemActions: Set<String> { [] }
	public func summary(limit: Int) async throws -> JSONValue { try await apple.upcomingEvents(limit: limit) }
	public func run(itemAction: String, itemID: String) async throws -> String { throw TodoError.invalid("Calendar items have no actions.") }
}

public struct RemindersFeedSource: FeedSource {
	let apple: AppleTools
	public init(apple: AppleTools) { self.apple = apple }
	public var category: String { "tasks" }
	public var providerName: String { "applereminders" }
	public var providerDisplayName: String { "Apple Reminders" }
	public var launchURL: String? { "x-apple-reminderkit://" }
	public var itemActions: Set<String> { ["tasks.completeItem"] }
	public func summary(limit: Int) async throws -> JSONValue { try await apple.openReminders(limit: limit) }
	public func run(itemAction: String, itemID: String) async throws -> String {
		guard itemAction == "tasks.completeItem" else { throw TodoError.invalid("Unsupported action.") }
		try await apple.completeReminder(itemID)
		return "Completed."
	}
}

/// The Feed (port of `feed/index.ts`, `collect.ts`, `rank.ts`, `state.ts`,
/// `execute.ts`, `personalization.ts`). State and the ranked Feed persist to
/// the same files the daemon used, so imported Feed state carries over.
public actor FeedService {
	public static let rankingVersion = "rank-v8"
	static let maxItems = 12
	static let rerankMaxAge: TimeInterval = 15 * 60
	static let recentTTL: TimeInterval = 86400
	static let fallbackAge: TimeInterval = 2 * 3600

	let sources: [any FeedSource]
	let todos: TodoService
	let memory: MemoryService
	let personas: PersonaService
	let ai: OpenRouterClient
	let tobyDirectory: URL
	let modelID: @Sendable () -> String
	let rank: (@Sendable (_ system: String, _ user: String) async throws -> JSONValue)?
	let compileRule: (@Sendable (_ text: String, _ candidates: [FeedCandidate]) async -> JSONValue)?
	var lastGood: [String: (at: Date, candidates: [FeedCandidate])] = [:]
	var inFlight: [String: Task<JSONValue, Error>] = [:]

	public init(
		sources: [any FeedSource],
		todos: TodoService,
		memory: MemoryService,
		personas: PersonaService,
		ai: OpenRouterClient,
		tobyDirectory: URL,
		modelID: @escaping @Sendable () -> String = { ModelDefaults.structured },
		rank: (@Sendable (String, String) async throws -> JSONValue)? = nil,
		compileRule: (@Sendable (String, [FeedCandidate]) async -> JSONValue)? = nil,
	) {
		self.compileRule = compileRule
		self.sources = sources
		self.todos = todos
		self.memory = memory
		self.personas = personas
		self.ai = ai
		self.tobyDirectory = tobyDirectory
		self.modelID = modelID
		self.rank = rank
	}

	var stateURL: URL { tobyDirectory.appending(path: "dashboard-feed-state.json") }
	var feedURL: URL { tobyDirectory.appending(path: "dashboard-feed.json") }

	// MARK: State file

	func loadState(now: Date = Date()) -> [String: JSONValue] {
		var state = ((try? Data(contentsOf: stateURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) })?.objectValue ?? [:]
		let cutoff = now.addingTimeInterval(-30 * 86400)
		var items: [String: JSONValue] = [:]
		for (id, entry) in state["items"]?.objectValue ?? [:] {
			guard let kind = entry["kind"]?.stringValue, let at = entry["at"]?.stringValue.flatMap(TodoRecurrence.parseISO) else { continue }
			if kind == "snoozed" {
				guard let until = entry["until"]?.stringValue.flatMap(TodoRecurrence.parseISO), until > now else { continue }
			} else if at < cutoff { continue }
			items[id] = entry
		}
		state["items"] = .object(items)
		state["notified"] = .object((state["notified"]?.objectValue ?? [:]).filter { ($0.value.stringValue.flatMap(TodoRecurrence.parseISO) ?? .distantPast) >= cutoff })
		let feedbackCutoff = now.addingTimeInterval(-90 * 86400)
		state["feedback"] = .array(Array((state["feedback"]?.arrayValue ?? []).filter { ($0["at"]?.stringValue.flatMap(TodoRecurrence.parseISO) ?? .distantPast) >= feedbackCutoff }.suffix(200)))
		if state["instructions"] == nil { state["instructions"] = [] }
		return state
	}

	func saveState(_ state: [String: JSONValue]) {
		try? JSONEncoder.tobyPretty.encode(JSONValue.object(state)).write(to: stateURL, options: .atomic)
	}

	func updateState(_ body: (inout [String: JSONValue]) -> Void) -> [String: JSONValue] {
		var state = loadState()
		body(&state)
		saveState(state)
		return state
	}

	func hiddenIDs(_ state: [String: JSONValue], now: Date) -> Set<String> {
		Set((state["items"]?.objectValue ?? [:]).filter { _, entry in
			guard entry["kind"] == "snoozed" else { return true }
			return (entry["until"]?.stringValue.flatMap(TodoRecurrence.parseISO) ?? .distantPast) > now
		}.keys)
	}

	func feedbackCounts(_ state: [String: JSONValue]) -> [String: Int] {
		var counts: [String: Int] = [:]
		for entry in state["feedback"]?.arrayValue ?? [] { if let key = entry["key"]?.stringValue { counts[key, default: 0] += 1 } }
		return counts
	}

	// MARK: Collect

	func collect(now: Date) async -> (candidates: [FeedCandidate], sources: [JSONValue]) {
		var candidates: [FeedCandidate] = []
		var sourceList: [JSONValue] = []
		await withTaskGroup(of: (Int, Result<JSONValue, Error>).self) { group in
			for (index, source) in sources.enumerated() {
				group.addTask { (index, await Result { try await source.summary(limit: source.category == "news" ? 12 : 30) }) }
			}
			var results = [(Int, Result<JSONValue, Error>)]()
			for await result in group { results.append(result) }
			for (index, result) in results.sorted(by: { $0.0 < $1.0 }) {
				let source = sources[index]
				let key = "\(source.category):\(source.providerName)"
				switch result {
				case let .success(summary):
					let fresh = (summary["items"]?.arrayValue ?? []).map {
						FeedCandidate(category: source.category, providerName: source.providerName, providerDisplayName: source.providerDisplayName, item: $0, providerActions: source.itemActions)
					}
					lastGood[key] = (now, fresh)
					candidates += fresh
				case .failure:
					if let last = lastGood[key], now.timeIntervalSince(last.at) <= Self.fallbackAge { candidates += last.candidates }
				}
				var entry: [String: JSONValue] = ["providerName": .string(source.providerName), "providerDisplayName": .string(source.providerDisplayName)]
				if let launch = source.launchURL { entry["launchUrl"] = .string(launch) }
				sourceList.append(.object(entry))
			}
		}
		let tomorrow = FeedText.localDateKey(now.addingTimeInterval(86400))
		if let open = try? todos.list(["status": "open", "limit": 200])["todos"]?.arrayValue {
			for todo in open {
				let dueDate = todo["due"]?["date"]?.stringValue
				let high = todo["priority"] == "high"
				guard todo["deleted"] != true, todo["state"]?["status"] == "open", (dueDate.map { $0 <= tomorrow } ?? false) || high,
				      let id = todo["id"]?.stringValue else { continue }
				let description = (todo["description"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
				candidates.append(FeedCandidate(
					id: FeedCandidate.makeID(category: "todos", provider: "toby", itemID: id), category: "todos", providerName: "toby",
					providerDisplayName: "Toby Todos", itemID: id, title: todo["title"]?.stringValue ?? "", detail: description.isEmpty ? nil : String(description.prefix(280)),
					dueDate: dueDate, urgency: high ? "high" : nil,
				))
			}
			sourceList.append(["providerName": "toby", "providerDisplayName": "Toby Todos"])
		}
		return (candidates, sourceList)
	}

	// MARK: Ranking

	func personalization(_ state: [String: JSONValue]) -> (instructions: [String], memories: [String], notRelevant: [String]) {
		let instructions = (state["instructions"]?.arrayValue ?? []).filter { $0["enabled"] != false }.compactMap { $0["text"]?.stringValue }
		var memories: [String] = []
		var used = 0
		for item in (try? memory.usableForPrompt(limit: 60)) ?? [] where item.sensitivity == "normal" {
			let subject = item.subject?.trimmingCharacters(in: .whitespaces).nilIfEmpty
			let line = "\(item.type)\(subject.map { " (\($0))" } ?? ""): \(MemoryText.collapseWhitespace(item.value))"
			if used + line.count > 2500 { break }
			memories.append(line)
			used += line.count
		}
		let notRelevant = (state["feedback"]?.arrayValue ?? []).suffix(15).reversed().map { f in
			"[\(f["category"]?.stringValue ?? "")] \(f["title"]?.stringValue ?? "")\(f["subtitle"]?.stringValue.map { " — \($0)" } ?? "")"
		}
		return (instructions, memories, notRelevant)
	}

	func systemPrompt(persona: Persona, personal: (instructions: [String], memories: [String], notRelevant: [String]), now: Date) -> String {
		let glossary = FeedActions.order.compactMap { id -> String? in
			guard let spec = FeedActions.specs[id], spec.kind != "open", spec.kind != "local" else { return nil }
			return "- \(id) (\"\(spec.label)\"): \(spec.hint)"
		}.joined(separator: "\n")
		let instructions = personal.instructions.isEmpty ? "" : """

		USER INSTRUCTIONS — highest priority. The user wrote these rules for The Feed. They override every default rule below.
		\(personal.instructions.map { "- \($0)" }.joined(separator: "\n"))
		How to apply them:
		- Apply them first, before anything else. Any instruction that says to ignore, skip, hide, leave out, or only show something is a hard filter: remove every candidate it excludes, even if that candidate looks urgent or important. Never include an excluded candidate just to fill the list; return fewer items instead.
		- Decide using each candidate's "source" (the connected app it came from), "from/list" (sender, list, or project), "assigned", and the other facts shown.
		- When a candidate lacks the fact an instruction depends on (for example, no "assigned" line), treat it as the user's own item.
		- Instructions about ordering or priority beat the default ranking rules.

		"""
		var personalParts: [String] = []
		if !personal.memories.isEmpty {
			personalParts.append("What you know about the user (from Toby memory). Use it to judge relevance — favor items tied to their people, projects, and interests:\n" + personal.memories.map { "- \($0)" }.joined(separator: "\n"))
		}
		if !personal.notRelevant.isEmpty {
			personalParts.append("Items the user recently marked \"not relevant\". Rank similar items (same sender, channel, topic, or kind) lower or leave them out:\n" + personal.notRelevant.map { "- \($0)" }.joined(separator: "\n"))
		}
		let base = """
		You are the user's personal assistant curating "The Feed": a short, prioritized list of the things across their email, calendar, tasks, chat, and news that most deserve their attention right now.
		\(instructions)
		Your job:
		1. Choose at most \(Self.maxItems) candidates that genuinely matter. Leave out noise: newsletters, automated notifications, marketing, and anything that needs no attention.
		2. Order them most important first, judging every item on its own merits regardless of source. Do not group items by source type (email, calendar, tasks); an overdue task or urgent email can outrank a routine meeting.
		3. Give each item a priority from 1 to 100 on one scale shared by all sources (90+: act immediately; 60–89: important today; 30–59: worth doing; below 30: minor).
		4. Assign a tier:
		   - now: needs attention within the next hour or so (meeting starting soon, urgent reply, overdue and important)
		   - today: should be handled today
		   - fyi: worth knowing, no rush
		5. Write one plain sentence of reason per item explaining why it matters now and what the user should do. Be specific (names, times, deadlines). No markdown.
		6. Pick 1–2 actions per item, best first, ONLY from that candidate's "allowed actions" list.
		Action meanings:
		\(glossary)
		Rules:
		- Only use candidate keys that appear in the list. Never invent items.
		- Treat the "signals" as facts computed from the source data.
		- Write times in the user's local timezone; never output raw ISO timestamps.
		- Calendar: being on the calendar is not enough. Include an event only when it needs something from the user — preparation, materials, a decision, a reply to the invite, a follow-up, or it starts within the hour and they need the heads-up. Leave out holds, focus or blocked time, placeholders, and routine recurring meetings with no agenda unless they are about to start. An event the user only needs to show up to is not Feed material — that includes talks, trainings, webinars, community or social events, and large meetings where they are mostly listening. Prefer events where the agenda or notes ask something of the user specifically. Tomorrow's events belong only when something must be prepared today. At most 3 calendar items unless more start within the hour.
		- Email: a person writing to the user is the email that matters — especially a known correspondent, a message sent directly to them, or one they have read but not replied to (someone is likely waiting). Rank those like a task due today, and above routine meetings. Mailing lists, newsletters, marketing, and automated notifications ("mailing list or automated sender") belong only when they carry a concrete deadline or action for the user (a bill or payment due, travel check-in, a security or account alert); then use the fyi or today tier as the deadline warrants.
		- Chat: direct messages and mentions where someone is waiting on the user rank like email that needs a reply; skip chatter that needs nothing from them.
		- News is context, not work: include at most 2 headlines, only when they plausibly matter to this user (their industry, employer, interests, location, or what they know from memory), always in the fyi tier with a low priority. Leave news out entirely when nothing fits.
		\(personalParts.isEmpty ? "" : "\n\(personalParts.joined(separator: "\n\n"))\n")
		\(ChatPrompt.dateTimeSection(now: now))
		"""
		return ChatPrompt.compose(base: base, persona: persona)
	}

	/// Candidates interleaved by category, with `c<N>` keys in original order.
	static func formatCandidates(_ candidates: [FeedCandidate]) -> String {
		guard !candidates.isEmpty else { return "(no candidates)" }
		var queues: [(String, [(FeedCandidate, Int)])] = []
		for (index, c) in candidates.enumerated() {
			if let q = queues.firstIndex(where: { $0.0 == c.category }) { queues[q].1.append((c, index)) } else { queues.append((c.category, [(c, index)])) }
		}
		var ordered: [(FeedCandidate, Int)] = []
		var round = 0
		while ordered.count < candidates.count {
			for queue in queues where round < queue.1.count { ordered.append(queue.1[round]) }
			round += 1
		}
		return ordered.map { c, index in
			var lines = ["c\(index + 1) [\(c.category)] \(c.title)", "   source: \(c.providerDisplayName ?? c.providerName)"]
			if let subtitle = c.subtitle { lines.append("   from/list: \(subtitle)") }
			let shared = c.task?["shared"] == true ? " (shared list)" : ""
			switch c.task?["assignment"]?.stringValue {
			case "you": lines.append("   assigned: to the user\(shared)")
			case "someone_else": lines.append("   assigned: to someone else\(shared)")
			case "unassigned": lines.append("   assigned: nobody\(shared)")
			default: if c.task?["shared"] == true { lines.append("   assigned: unknown (shared list)") }
			}
			if let detail = c.detail { lines.append("   detail: \(String(detail.prefix(280)))") }
			if let notes = c.event?["notes"]?.stringValue { lines.append("   notes: \(String(MemoryText.collapseWhitespace(notes).prefix(280)))") }
			if let timestamp = c.timestamp { lines.append("   when: \(FeedText.localTimestamp(timestamp))") }
			if let due = c.dueDate { lines.append("   due: \(due)") }
			if let urgency = c.urgency { lines.append("   urgency: \(urgency)") }
			if !c.signals.isEmpty { lines.append("   signals: \(c.signals.joined(separator: "; "))") }
			lines.append("   allowed actions: \(FeedActions.allowedIDs(c).joined(separator: ", "))")
			return lines.joined(separator: "\n")
		}.joined(separator: "\n")
	}

	static let rankingSchema: JSONSchema = .object([
		"items": .array(.object([
			"key": .string(description: "Candidate key, e.g. c3"),
			"tier": .string(enum: ["now", "today", "fyi"]),
			"priority": .number(description: "Importance from 1 (low) to 100 (critical), comparable across sources"),
			"reason": .string(description: "One sentence: why this matters to the user now"),
			"actions": .array(.string(), description: "Action ids from the candidate's allowed list, best first"),
		]), description: "Most relevant items first"),
	])

	/// Ranked output → Feed items (tier, then priority), capped per category.
	static func items(from ranking: JSONValue, candidates: [FeedCandidate]) -> [JSONValue] {
		let byKey = Dictionary(candidates.enumerated().map { ("c\($0.offset + 1)", $0.element) }, uniquingKeysWith: { a, _ in a })
		var used = Set<String>()
		var ranked: [(item: JSONValue, tier: Int, priority: Double, index: Int)] = []
		for entry in ranking["items"]?.arrayValue ?? [] {
			let key = (entry["key"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces).lowercased()
			guard let c = byKey[key], !used.contains(key), let tier = entry["tier"]?.stringValue, let tierIndex = ["now", "today", "fyi"].firstIndex(of: tier) else { continue }
			used.insert(key)
			var source: [String: JSONValue] = ["category": .string(c.category), "providerName": .string(c.providerName), "itemId": .string(c.itemID)]
			if let display = c.providerDisplayName { source["providerDisplayName"] = .string(display) }
			if let url = c.url { source["url"] = .string(url) }
			let reason = (entry["reason"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			var item: [String: JSONValue] = [
				"id": .string(c.id), "source": .object(source), "tier": .string(tier), "title": .string(c.title),
				"reason": .string(reason.isEmpty ? c.signals.joined(separator: "; ") : reason),
				"actions": .array(FeedActions.resolve(c, chosen: (entry["actions"]?.arrayValue ?? []).compactMap(\.stringValue))),
			]
			if let subtitle = c.subtitle { item["subtitle"] = .string(subtitle) }
			if let timestamp = c.timestamp { item["timestamp"] = .string(timestamp) }
			let priority = entry["priority"]?.doubleValue.map { min(100, max(1, $0.rounded())) } ?? 0
			ranked.append((.object(item), tierIndex, priority, ranked.count))
			if ranked.count >= maxItems { break }
		}
		let sorted = ranked.sorted { $0.tier != $1.tier ? $0.tier < $1.tier : ($0.priority != $1.priority ? $0.priority > $1.priority : $0.index < $1.index) }
		var counts: [String: Int] = [:]
		let caps = ["calendar": 3, "news": 2]
		return sorted.compactMap { entry -> JSONValue? in
			let category = entry.item["source"]?["category"]?.stringValue ?? ""
			guard let cap = caps[category] else { return entry.item }
			if category == "calendar", entry.item["tier"] == "now" { return entry.item }
			let n = counts[category, default: 0]
			counts[category] = n + 1
			if n >= cap { return Optional<JSONValue>.none }
			return entry.item
		}
	}

	// MARK: Content

	func persisted() -> JSONValue? {
		(try? Data(contentsOf: feedURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
	}

	func persist(signature: String, content: JSONValue, now: Date) {
		let previous = persisted()
		var recent: [JSONValue] = []
		var seen = Set((content["items"]?.arrayValue ?? []).compactMap { $0["id"]?.stringValue })
		if let previous {
			let older = (previous["content"]?["items"]?.arrayValue ?? []).map { ["item": $0, "seenAt": previous["rankedAt"] ?? .null] as JSONValue } + (previous["recentItems"]?.arrayValue ?? [])
			for entry in older {
				guard let id = entry["item"]?["id"]?.stringValue, seen.insert(id).inserted,
				      let seenAt = entry["seenAt"]?.stringValue.flatMap(TodoRecurrence.parseISO), now.timeIntervalSince(seenAt) <= Self.recentTTL else { continue }
				recent.append(entry)
				if recent.count >= 100 { break }
			}
		}
		let entry: JSONValue = ["signature": .string(signature), "rankedAt": .string(TodoRecurrence.isoString(now)), "content": content, "recentItems": .array(recent)]
		try? JSONEncoder.tobyPretty.encode(entry).write(to: feedURL, options: .atomic)
	}

	func findItem(_ id: String) -> JSONValue? {
		guard let feed = persisted() else { return nil }
		return feed["content"]?["items"]?.arrayValue?.first { $0["id"]?.stringValue == id }
			?? feed["recentItems"]?.arrayValue?.first { $0["item"]?["id"]?.stringValue == id }?["item"]
	}

	/// Visible content: hide state-hidden items and rule-filtered items.
	func visible(_ content: JSONValue, now: Date = Date()) -> JSONValue {
		let state = loadState(now: now)
		let hidden = hiddenIDs(state, now: now)
		let filters = FeedRules.active(state["instructions"]?.arrayValue ?? [])
		guard case var .object(object) = content else { return content }
		object["items"] = .array((content["items"]?.arrayValue ?? []).filter { item in
			guard let id = item["id"]?.stringValue, !hidden.contains(id) else { return false }
			let source = item["source"]
			return !filters.contains { FeedRules.matches($0, category: source?["category"]?.stringValue ?? "", providerName: source?["providerName"]?.stringValue ?? "", providerDisplayName: source?["providerDisplayName"]?.stringValue, subtitle: item["subtitle"]?.stringValue, task: nil) }
		})
		return .object(object)
	}

	/// The Feed (`GET /api/dashboard/feed`). `force` re-collects and re-ranks.
	public func content(force: Bool = false, awaitRerank: Bool = false) async throws -> JSONValue {
		let now = Date()
		return visible(try await build(force: force, awaitRerank: awaitRerank, now: now), now: now)
	}

	func build(force: Bool, awaitRerank: Bool, now: Date) async throws -> JSONValue {
		let persona = personas.defaultPersona()
		let model = modelID()
		let collection = await collect(now: now)
		var state = loadState(now: now)
		try await compilePendingRules(candidates: collection.candidates, now: now)
		state = loadState(now: now)
		let hidden = hiddenIDs(state, now: now)
		let filtered = FeedRules.apply(collection.candidates.filter { !hidden.contains($0.id) }, FeedRules.active(state["instructions"]?.arrayValue ?? []))
		let candidates = FeedPrefilter.prefilter(filtered, now: now, feedback: feedbackCounts(state))
		let personal = personalization(state)
		let base: [String: JSONValue] = [
			"generatedAt": .string(TodoRecurrence.isoString(now)), "personaName": .string(persona.name),
			"model": ["provider": "openrouter", "model": .string(model)], "sources": .array(collection.sources),
		]
		if collection.sources.isEmpty { return .object(base.merging(["status": "noSources", "items": []]) { a, _ in a }) }
		if candidates.isEmpty { return .object(base.merging(["status": "ok", "items": []]) { a, _ in a }) }
		let personalSignature = String(FeedText.sha(JSONValue.object([
			"instructions": .array(personal.instructions.map(JSONValue.string)), "memories": .array(personal.memories.map(JSONValue.string)),
			"notRelevant": .array(personal.notRelevant.map(JSONValue.string)),
		]).jsonString()).prefix(16))
		let signature = FeedPrefilter.signature(candidates, extra: [Self.rankingVersion, "openrouter", model, persona.name, personalSignature])
		if !force, let previous = persisted(), previous["content"] != nil {
			let fresh = previous["rankedAt"]?.stringValue.flatMap(TodoRecurrence.parseISO).map { now.timeIntervalSince($0) < Self.rerankMaxAge } ?? false
			if previous["signature"]?.stringValue == signature, fresh { return previous["content"]! }
			if previous["content"]?["status"] == "ok", !awaitRerank {
				_ = rerank(signature: signature, candidates: candidates, persona: persona, personal: personal, base: base, model: model)
				return previous["content"]!
			}
		}
		return try await rerank(signature: signature, candidates: candidates, persona: persona, personal: personal, base: base, model: model).value
	}

	func rerank(signature: String, candidates: [FeedCandidate], persona: Persona, personal: (instructions: [String], memories: [String], notRelevant: [String]), base: [String: JSONValue], model: String) -> Task<JSONValue, Error> {
		if let existing = inFlight[signature] { return existing }
		let system = systemPrompt(persona: persona, personal: personal, now: Date())
		var user = "Candidates:\n\n\(Self.formatCandidates(candidates))"
		if !personal.instructions.isEmpty {
			user += "\n\nBefore ranking, drop every candidate the user's instructions exclude. Their instructions:\n" + personal.instructions.map { "- \($0)" }.joined(separator: "\n")
		}
		let ai = ai
		let rank = rank
		let task = Task<JSONValue, Error> { [self] in
			defer { Task { await self.finished(signature) } }
			let ranking: JSONValue
			do {
				if let rank { ranking = try await rank(system, user) } else { ranking = try await generateJSON(ObjectRequest(
					model: ai.model(model), instructions: system, messages: [.user(user)], schema: Self.rankingSchema,
					schemaName: "FeedRanking", schemaDescription: "Prioritized Feed items with tier, reason, and allowed actions",
					temperature: 0.2, maxOutputTokens: 4000,
				)).object }
			} catch let error as AIError {
				if case .insufficientCredits = error { throw error }
				var failed = base
				failed["status"] = "error"
				failed["items"] = await self.persisted()?["content"]?["items"] ?? []
				failed["error"] = .string(error.localizedDescription)
				return .object(failed)
			}
			var content = base
			content["status"] = "ok"
			content["items"] = .array(Self.items(from: ranking, candidates: candidates))
			await self.persist(signature: signature, content: .object(content), now: Date())
			return .object(content)
		}
		inFlight[signature] = task
		return task
	}

	func finished(_ signature: String) { inFlight[signature] = nil }

	func compilePendingRules(candidates: [FeedCandidate], now: Date) async throws {
		let instructions = loadState(now: now)["instructions"]?.arrayValue ?? []
		let pending = instructions.filter { instruction in
			guard instruction["enabled"] != false, let text = instruction["text"]?.stringValue else { return false }
			guard let rule = instruction["rule"], rule["hash"]?.stringValue == FeedRules.hash(text) else { return true }
			guard rule["status"] == "failed" else { return false }
			return now.timeIntervalSince(rule["at"]?.stringValue.flatMap(TodoRecurrence.parseISO) ?? .distantPast) >= 3600
		}
		for instruction in pending {
			guard let id = instruction["id"]?.stringValue, let text = instruction["text"]?.stringValue else { continue }
			let rule: JSONValue = if let compileRule { await compileRule(text, candidates) } else {
				await FeedRules.compile(text, candidates: candidates, model: ai.model(modelID()), now: now)
			}
			_ = updateState { state in
				state["instructions"] = .array((state["instructions"]?.arrayValue ?? []).map { entry in
					guard entry["id"]?.stringValue == id, FeedRules.hash(entry["text"]?.stringValue ?? "") == rule["hash"]?.stringValue, case var .object(object) = entry else { return entry }
					object["rule"] = rule
					return .object(object)
				})
			}
		}
	}

	// MARK: Actions (`POST /api/dashboard/feed/actions`)

	public func perform(itemID: String, actionID: String) async throws -> JSONValue {
		guard let item = findItem(itemID) else { throw TodoError("not_found", "That item is no longer in The Feed. Refresh and try again.", status: 404) }
		guard let action = item["actions"]?.arrayValue?.first(where: { $0["id"]?.stringValue == actionID }) else {
			throw TodoError.invalid("\"\(actionID)\" isn't available for this item.")
		}
		let kind = action["kind"]?.stringValue ?? ""
		if kind == "chat" || kind == "open" { throw TodoError.invalid("\"\(action["label"]?.stringValue ?? actionID)\" runs in the app.") }
		let now = Date()
		let at = TodoRecurrence.isoString(now)
		let source = item["source"] ?? .null
		let category = source["category"]?.stringValue ?? ""
		let provider = source["providerName"]?.stringValue ?? ""
		let title = item["title"]?.stringValue ?? ""
		func record(_ entry: JSONValue) {
			_ = updateState { state in
				var items = state["items"]?.objectValue ?? [:]
				items[itemID] = entry
				state["items"] = .object(items)
			}
		}
		var message: String
		var todoID: String?
		switch actionID {
		case "dismiss":
			record(["kind": "dismissed", "at": .string(at)])
			message = "Dismissed."
		case "notRelevant":
			let key = FeedPrefilter.feedbackKey(category: category, providerName: provider, title: title, subtitle: item["subtitle"]?.stringValue) ?? "\(category):\(provider):\(title.lowercased())"
			record(["kind": "dismissed", "at": .string(at)])
			_ = updateState { state in
				var feedback: [String: JSONValue] = ["key": .string(key), "category": .string(category), "title": .string(title), "at": .string(at)]
				if let subtitle = item["subtitle"]?.stringValue { feedback["subtitle"] = .string(subtitle) }
				state["feedback"] = .array(Array(((state["feedback"]?.arrayValue ?? []) + [.object(feedback)]).suffix(200)))
			}
			message = "Got it — you'll see fewer items like this."
		case "snooze":
			var tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now) ?? now
			tomorrow = Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: tomorrow) ?? tomorrow
			record(["kind": "snoozed", "at": .string(at), "until": .string(TodoRecurrence.isoString(tomorrow))])
			message = "Snoozed until tomorrow morning."
		case "todo.add":
			let sourceName = source["providerDisplayName"]?.stringValue ?? provider
			var lines = ["Added from The Feed (\(sourceName)\(item["subtitle"]?.stringValue.map { " · \($0)" } ?? "")).", "", item["reason"]?.stringValue ?? ""]
			if let url = source["url"]?.stringValue { lines += ["", url] }
			var input: [String: JSONValue] = ["title": .string(title), "description": .string(lines.joined(separator: "\n"))]
			if category == "calendar", let at = item["timestamp"]?.stringValue.flatMap(TodoRecurrence.parseISO) {
				input["due"] = ["date": .string(FeedText.localDateKey(at)), "timezone": .string(TimeZone.current.identifier)]
			}
			todoID = try todos.create(.object(input), context: TodoMutationContext(source: "feed"))["id"]?.stringValue
			record(["kind": "done", "at": .string(at), "action": "todo.add"])
			message = "Added to your todos."
		case "task.complete" where category == "todos":
			_ = try todos.transition(source["itemId"]?.stringValue ?? "", action: "complete", sequence: nil, allowIncompleteChecklist: true, context: TodoMutationContext(source: "feed"))
			record(["kind": "done", "at": .string(at), "action": "task.complete"])
			message = "Completed."
		default:
			guard let standard = FeedActions.providerActions[actionID], let feedSource = sources.first(where: { $0.providerName == provider }) else {
				throw TodoError.invalid("\"\(action["label"]?.stringValue ?? actionID)\" can't run here.")
			}
			let previous = loadState(now: now)["items"]?[itemID]
			record(["kind": "done", "at": .string(at), "action": .string(actionID)])
			do {
				message = try await feedSource.run(itemAction: standard, itemID: source["itemId"]?.stringValue ?? "")
			} catch {
				_ = updateState { state in
					var items = state["items"]?.objectValue ?? [:]
					items[itemID] = previous
					state["items"] = .object(items)
				}
				throw TodoError("action_failed", (error as? LocalizedError)?.errorDescription ?? "\(action["label"]?.stringValue ?? actionID) failed.", status: 502)
			}
		}
		var response: [String: JSONValue] = ["ok": true, "message": .string(message)]
		if let todoID { response["todoId"] = .string(todoID) }
		if let content = persisted()?["content"] { response["content"] = visible(content, now: now) }
		return .object(response)
	}

	// MARK: Instructions

	func instructionsBody(_ state: [String: JSONValue]) -> JSONValue {
		["instructions": .array((state["instructions"]?.arrayValue ?? []).map { instruction in
			var object = instruction.objectValue ?? [:]
			let rule = object.removeValue(forKey: "rule")
			if let rule, rule["hash"]?.stringValue == FeedRules.hash(instruction["text"]?.stringValue ?? "") {
				switch rule["status"]?.stringValue {
				case "filter": object["enforcement"] = "filter"; object["enforcementSummary"] = rule["summary"] ?? ""
				case "guidance": object["enforcement"] = "guidance"
				default: object["enforcement"] = "pending"
				}
			} else {
				object["enforcement"] = "pending"
			}
			return .object(object)
		})]
	}

	public func instructions() -> JSONValue { instructionsBody(loadState()) }

	public func addInstruction(_ raw: String) throws -> JSONValue {
		let text = MemoryText.collapseWhitespace(raw)
		guard !text.isEmpty else { throw TodoError.invalid("Instruction text is required.") }
		guard text.count <= 500 else { throw TodoError.invalid("Keep instructions under 500 characters.") }
		guard (loadState()["instructions"]?.arrayValue ?? []).count < 50 else { throw TodoError.invalid("You can keep up to 50 instructions. Delete one first.") }
		let state = updateState { state in
			state["instructions"] = .array((state["instructions"]?.arrayValue ?? []) + [[
				"id": .string(UUID().uuidString.lowercased()), "text": .string(text), "createdAt": .string(TodoRecurrence.isoString(Date())), "enabled": true,
			]])
		}
		Task { try? await self.compilePendingRules(candidates: await self.collect(now: Date()).candidates, now: Date()) }
		return instructionsBody(state)
	}

	public func setInstruction(_ id: String, enabled: Bool) throws -> JSONValue {
		guard (loadState()["instructions"]?.arrayValue ?? []).contains(where: { $0["id"]?.stringValue == id }) else { throw TodoError("not_found", "Instruction not found", status: 404) }
		return instructionsBody(updateState { state in
			state["instructions"] = .array((state["instructions"]?.arrayValue ?? []).map { entry in
				guard entry["id"]?.stringValue == id, case var .object(object) = entry else { return entry }
				object["enabled"] = .bool(enabled)
				return .object(object)
			})
		})
	}

	public func removeInstruction(_ id: String) throws -> JSONValue {
		guard (loadState()["instructions"]?.arrayValue ?? []).contains(where: { $0["id"]?.stringValue == id }) else { throw TodoError("not_found", "Instruction not found", status: 404) }
		return instructionsBody(updateState { state in
			state["instructions"] = .array((state["instructions"]?.arrayValue ?? []).filter { $0["id"]?.stringValue != id })
		})
	}

	// MARK: Scheduler

	/// Re-rank every `interval` during active hours (7–22); notify new "now" items once.
	public func runScheduler(interval: Duration = .seconds(15 * 60), notify: @escaping @Sendable (JSONValue) async -> Void) async {
		while !Task.isCancelled {
			let hour = Calendar.current.component(.hour, from: Date())
			var fetched: JSONValue?
			if (7 ..< 22).contains(hour) {
				do { fetched = try await content(force: false, awaitRerank: true) } catch {
					TobyLog.shared.warn("feed", "feed_refresh_failed", ["error": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")])
				}
			}
			if let content = fetched {
				let state = loadState()
				let notified = state["notified"]?.objectValue ?? [:]
				let fresh = (content["items"]?.arrayValue ?? []).filter { $0["tier"] == "now" && notified[$0["id"]?.stringValue ?? ""] == nil }
				for item in fresh { await notify(item) }
				if !fresh.isEmpty {
					let at = TodoRecurrence.isoString(Date())
					_ = updateState { state in
						var notified = state["notified"]?.objectValue ?? [:]
						for item in fresh { if let id = item["id"]?.stringValue { notified[id] = .string(at) } }
						state["notified"] = .object(notified)
					}
				}
			}
			try? await Task.sleep(for: interval)
		}
	}
}
