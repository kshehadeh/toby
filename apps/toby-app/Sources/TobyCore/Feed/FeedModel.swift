import CryptoKit
import Foundation
import TobyAI

/// A Feed candidate (port of `feed/types.ts` `FeedCandidate`).
public struct FeedCandidate: Sendable, Hashable {
	public var id: String
	public var category: String
	public var providerName: String
	public var providerDisplayName: String?
	public var itemID: String
	var identity: JSONValue?
	var cardID: String?
	var sequence: Int?
	public var title: String
	public var subtitle: String?
	public var detail: String?
	public var timestamp: String?
	public var dueDate: String?
	public var urgency: String?
	public var url: String?
	public var event: JSONValue?
	public var email: JSONValue?
	public var task: JSONValue?
	public var providerActions: Set<String> = []
	public var signals: [String] = []
	public var score: Double = 0

	public static func makeID(category: String, provider: String, itemID: String) -> String { "\(category):\(provider):\(itemID)" }

	/// From a dashboard summary item (`{id, title, subtitle, …}`).
	public init(category: String, providerName: String, providerDisplayName: String?, item: JSONValue, providerActions: Set<String> = []) {
		itemID = item["id"]?.stringValue ?? ""
		id = Self.makeID(category: category, provider: providerName, itemID: itemID)
		self.category = category
		self.providerName = providerName
		self.providerDisplayName = providerDisplayName
		title = item["title"]?.stringValue?.nilIfEmpty ?? "(untitled)"
		subtitle = item["subtitle"]?.stringValue?.nilIfEmpty
		detail = item["detail"]?.stringValue?.nilIfEmpty
		timestamp = item["timestamp"]?.stringValue?.nilIfEmpty
		urgency = item["urgency"]?.stringValue
		url = item["url"]?.stringValue?.nilIfEmpty
		identity = item["identity"]
		event = item["event"]
		email = item["email"]
		task = item["task"]
		self.providerActions = providerActions
	}

	public init(id: String, category: String, providerName: String, providerDisplayName: String?, itemID: String, title: String, detail: String? = nil, dueDate: String? = nil, urgency: String? = nil) {
		self.id = id
		self.category = category
		self.providerName = providerName
		self.providerDisplayName = providerDisplayName
		self.itemID = itemID
		self.title = title
		self.detail = detail
		self.dueDate = dueDate
		self.urgency = urgency
	}
}

// MARK: Actions (port of `feed/actions.ts`)

public enum FeedActions {
	public struct Spec: Sendable {
		public var label: String
		public var kind: String
		public var hint: String
	}

	public static let order = ["email.draftReply", "email.archive", "email.markRead", "calendar.prep", "task.complete", "task.help", "todo.add", "chat.draftReply", "news.discuss", "open", "snooze", "notRelevant", "dismiss"]
	public static let specs: [String: Spec] = [
		"email.draftReply": Spec(label: "Draft a reply", kind: "chat", hint: "the email asks the user something or expects a response"),
		"email.archive": Spec(label: "Archive", kind: "tool", hint: "informational mail the user can file away"),
		"email.markRead": Spec(label: "Mark read", kind: "tool", hint: "FYI mail that needs no action"),
		"calendar.prep": Spec(label: "Prep for this meeting", kind: "chat", hint: "a meeting worth preparing for (external people, agenda, decisions)"),
		"task.complete": Spec(label: "Mark complete", kind: "tool", hint: "a task that looks quick or may already be done"),
		"task.help": Spec(label: "Help me with this", kind: "chat", hint: "a task that needs thinking, research, or writing"),
		"todo.add": Spec(label: "Add to my todo list", kind: "tool", hint: "the item implies follow-up work the user should track"),
		"chat.draftReply": Spec(label: "Draft a reply", kind: "chat", hint: "someone asked the user a question or is waiting on them in chat"),
		"news.discuss": Spec(label: "Tell me more", kind: "chat", hint: "a story worth a short briefing"),
		"open": Spec(label: "Open", kind: "open", hint: "view the original item"),
		"snooze": Spec(label: "Snooze until tomorrow", kind: "local", hint: "hide until tomorrow morning"),
		"notRelevant": Spec(label: "Not relevant to me", kind: "local", hint: "hide and show fewer items like this"),
		"dismiss": Spec(label: "Dismiss", kind: "local", hint: "hide from the Feed"),
	]
	/// Feed action → standard item action the source implements.
	public static let providerActions = ["email.archive": "email.archiveItem", "email.markRead": "email.markItemRead", "task.complete": "tasks.completeItem"]
	static let allowed: [String: [String]] = [
		"email": ["email.draftReply", "todo.add", "email.archive", "email.markRead"],
		"calendar": ["calendar.prep", "todo.add"],
		"tasks": ["task.help", "task.complete"], "todos": ["task.help", "task.complete"],
		"chat": ["chat.draftReply", "todo.add"], "news": ["news.discuss"],
	]
	static let alwaysOffered: [String: [String]] = ["tasks": ["task.complete"], "todos": ["task.complete"]]
	static let defaultPrimary = ["email": "email.draftReply", "calendar": "calendar.prep", "tasks": "task.help", "todos": "task.help", "chat": "chat.draftReply", "news": "news.discuss"]

	public static func isSupported(_ id: String, _ candidate: FeedCandidate) -> Bool {
		if id == "task.complete", candidate.category == "todos" { return true }
		guard let standard = providerActions[id] else { return true }
		return candidate.providerActions.contains(standard)
	}

	public static func allowedIDs(_ candidate: FeedCandidate) -> [String] {
		(allowed[candidate.category] ?? []).filter { isSupported($0, candidate) }
	}

	static func chatPrompt(_ id: String, _ c: FeedCandidate) -> String? {
		let ref = "(\(c.providerDisplayName ?? c.providerName) item id `\(c.itemID)`)"
		let subtitleFrom = c.subtitle.map { " from \($0)" } ?? ""
		let subtitleParen = c.subtitle.map { " (\($0)" + ")" } ?? ""
		switch id {
		case "email.draftReply":
			return "Draft a reply to the email \"\(c.title)\"\(subtitleFrom) \(ref). Read the full message first, then write a reply in my voice and save it as a draft. Do not send it — show me the draft so I can review it."
		case "calendar.prep":
			let at = c.timestamp.map(FeedText.localTimestamp) ?? ""
			return "Help me prepare for \"\(c.title)\"\(at.isEmpty ? "" : " on \(at)") \(ref). Look at the attendees, any related recent email, and my notes, then give me a short prep brief: purpose, what I need to know, and questions or decisions to raise."
		case "task.help":
			return "Help me with the task \"\(c.title)\"\(subtitleParen) \(ref). Break it into concrete next steps and do any research or drafting you can for me."
		case "chat.draftReply":
			return ["Draft a reply to this \(c.providerDisplayName ?? "chat") message\(subtitleParen) \(ref): \"\(c.detail ?? c.title)\".",
			        c.url.map { "Link: \($0)." } ?? "",
			        "Read the thread for context if you can, then write a reply in my voice. Do not post it — show me the draft so I can review it."].filter { !$0.isEmpty }.joined(separator: " ")
		case "news.discuss":
			return ["Give me a short briefing on this story: \"\(c.title)\"\(subtitleParen).", c.url.map { "Source: \($0)." } ?? "",
			        "Explain what happened, why it matters, and anything relevant to me."].filter { !$0.isEmpty }.joined(separator: " ")
		default:
			return nil
		}
	}

	static func build(_ id: String, _ c: FeedCandidate) -> JSONValue? {
		guard let spec = specs[id] else { return nil }
		var action: [String: JSONValue] = ["id": .string(id), "label": .string(spec.label), "kind": .string(spec.kind)]
		switch spec.kind {
		case "open":
			guard let url = c.url else { return nil }
			action["url"] = .string(url)
		case "chat":
			guard let prompt = chatPrompt(id, c) else { return nil }
			action["prompt"] = .string(prompt)
		default:
			break
		}
		return .object(action)
	}

	/// The model's chosen ids → concrete actions (plus open/snooze/notRelevant/dismiss).
	public static func resolve(_ c: FeedCandidate, chosen: [String]) -> [JSONValue] {
		let allowedIDs = Set(allowedIDs(c))
		var ids: [String] = []
		for raw in chosen {
			let id = raw.trimmingCharacters(in: .whitespaces)
			if allowedIDs.contains(id), !ids.contains(id) { ids.append(id) }
		}
		if ids.isEmpty, let primary = defaultPrimary[c.category] { ids.append(primary) }
		for id in alwaysOffered[c.category] ?? [] where allowedIDs.contains(id) && !ids.contains(id) { ids.append(id) }
		ids += ["open", "snooze", "notRelevant", "dismiss"]
		return ids.compactMap { build($0, c) }
	}
}

// MARK: Text helpers

enum FeedText {
	/// "Saturday, August 29, 2026 at 10:00 AM EDT"; date-only values unchanged.
	static func localTimestamp(_ timestamp: String) -> String {
		let trimmed = timestamp.trimmingCharacters(in: .whitespaces)
		if trimmed.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil { return trimmed }
		guard let date = TodoRecurrence.parseISO(trimmed) else { return timestamp }
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US")
		formatter.dateFormat = "EEEE, MMMM d, yyyy 'at' h:mm a zzz"
		return formatter.string(from: date)
	}

	static func plural(_ n: Int, _ unit: String) -> String { "\(n) \(unit)\(n == 1 ? "" : "s")" }

	static func localDateKey(_ date: Date, timezone: TimeZone = .current) -> String {
		TodoRecurrence.localDateTime(date, timezone: timezone.identifier).date
	}

	static func sha(_ text: String) -> String {
		SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
	}
}

// MARK: Pre-filter (port of `feed/prefilter.ts`)

public enum FeedPrefilter {
	static let maxCandidates = 40
	static let maxPerCategory = 15
	static let maxFor = ["news": 6, "calendar": 8]
	static let minute: Double = 60
	static let hour: Double = 3600
	static let day: Double = 86400
	static let maxBulkEmails = 4
	nonisolated(unsafe) static let bulkSender = /(?i)(no-?reply|do-?not-?reply|newsletter|notifications?@|notify@|mailer|marketing|digest|updates?@|news@|info@|hello@|team@|support@)/
	nonisolated(unsafe) static let holdTitle = /(?i)^\s*(?:\[?(?:hold|tentative|placeholder)\]?(?:\s*[:\-–—].*|\s+.*)?|blocked|block(?:\s*[:\-–—].*)?|busy|focus(?:\s+(?:time|block))?|deep\s+work|heads[\s-]?down(?:\s+time)?|do\s+not\s+(?:book|schedule)|dnb|no\s+meetings|ooo|out\s+of\s+(?:the\s+)?office|lunch|commute|travel(?:\s+time)?|personal|private|(?:take\s+a\s+)?break|gym|workout|\(untitled\)|untitled)\s*$/

	static func dayDiff(_ from: String, _ to: String) -> Int {
		guard let a = TodoRecurrence.nominal(from, "12:00"), let b = TodoRecurrence.nominal(to, "12:00") else { return 0 }
		return Int((b.timeIntervalSince(a) / day).rounded())
	}

	public static func isCalendarHold(_ c: FeedCandidate) -> Bool {
		let notes = c.event?["notes"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let attendees = c.event?["attendeeCount"]?.intValue ?? 0
		if c.title.wholeMatch(of: holdTitle) != nil, attendees < 3 { return true }
		guard let facts = c.event, !facts.isNull else { return false }
		let location = facts["location"]?.stringValue?.trimmingCharacters(in: .whitespaces) ?? ""
		return notes.isEmpty && location.isEmpty && attendees < 2
	}

	public static func isBulkEmail(_ c: FeedCandidate) -> Bool {
		if let bulk = c.email?["bulk"]?.boolValue { return bulk }
		return c.subtitle.map { $0.firstMatch(of: bulkSender) != nil } ?? false
	}

	static func scoreCalendar(_ c: FeedCandidate, now: Date) -> (Double, [String])? {
		if isCalendarHold(c) { return nil }
		guard let start = c.timestamp.flatMap(TodoRecurrence.parseISO) else { return (10, []) }
		let delta = start.timeIntervalSince(now)
		if delta < -30 * minute || delta > 3 * day { return nil }
		let days = dayDiff(FeedText.localDateKey(now), FeedText.localDateKey(start))
		if c.event?["allDay"] == true { return days == 0 ? (10, ["all-day event today"]) : nil }
		var signals: [String] = []
		var score: Double
		if delta <= 0 { signals.append("in progress"); score = 60 }
		else if delta <= hour { signals.append("starts in \(FeedText.plural(max(1, Int((delta / minute).rounded())), "minute"))"); score = 90 }
		else if delta <= 4 * hour { signals.append("starts in \(FeedText.plural(Int((delta / hour).rounded()), "hour"))"); score = 70 }
		else if days == 0 { signals.append("later today"); score = 50 }
		else if days == 1 { signals.append("tomorrow"); score = 30 }
		else { signals.append("in \(FeedText.plural(days, "day"))"); score = 15 }
		if c.urgency == "high" { score += 10 }
		if let facts = c.event, !facts.isNull {
			let attendees = facts["attendeeCount"]?.intValue ?? 0
			if attendees > 25 {
				signals.append("large meeting (\(attendees) invitees)")
				if delta > hour { score -= 10 }
			} else if attendees >= 2 {
				signals.append("with \(FeedText.plural(attendees - 1, "other person").replacingOccurrences(of: "persons", with: "people"))")
			}
			if !(facts["notes"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty {
				signals.append("has notes or an agenda"); score += 5
			} else {
				signals.append("no notes or agenda")
			}
			if facts["recurring"] == true {
				signals.append("recurring meeting")
				if delta > hour { score -= 15 }
			}
		}
		return (score, signals)
	}

	static func scoreEmail(_ c: FeedCandidate, now: Date) -> (Double, [String])? {
		var signals: [String] = []
		let bulk = isBulkEmail(c)
		var score: Double
		if bulk { signals.append("mailing list or automated sender"); score = 5 } else { signals.append("personal email from a person"); score = 45 }
		if c.urgency == "high" { signals.append("flagged"); score += bulk ? 50 : 30 }
		let awaiting = c.email?["awaitingReply"] == true
		if awaiting { signals.append("read but not replied to"); score += 15 }
		if c.email?["knownSender"] == true { signals.append("from someone the user has emailed before"); score += 15 }
		if c.email?["direct"] == true, !bulk { signals.append("sent directly to the user"); score += 5 }
		if let received = c.timestamp.flatMap(TodoRecurrence.parseISO) {
			let age = now.timeIntervalSince(received)
			if age <= 4 * hour { signals.append("received in the last few hours"); score += bulk ? 5 : 20 }
			else if age <= day { signals.append("received today"); score += bulk ? 0 : 10 }
			else if age > 7 * day { signals.append("unread for \(FeedText.plural(Int(age / day), "day"))"); score -= 10 }
			else { signals.append("received \(FeedText.plural(Int(age / day), "day")) ago") }
			if awaiting, age > 3 * day { score -= 15 }
		}
		return (score, signals)
	}

	static func scoreTask(_ c: FeedCandidate, now: Date) -> (Double, [String])? {
		var signals: [String] = []
		var score: Double = 20
		if c.urgency == "high" { signals.append("high priority"); score += 30 }
		let dueKey = c.dueDate ?? c.timestamp.flatMap(TodoRecurrence.parseISO).map { FeedText.localDateKey($0) }
		if let dueKey {
			let days = dayDiff(FeedText.localDateKey(now), dueKey)
			if days < 0 { signals.append("overdue by \(FeedText.plural(-days, "day"))"); score += 50 }
			else if days == 0 { signals.append("due today"); score += 40 }
			else if days == 1 { signals.append("due tomorrow"); score += 15 }
		}
		return (score, signals)
	}

	static func scoreChat(_ c: FeedCandidate, now: Date) -> (Double, [String])? {
		var signals: [String] = []
		var score: Double = 40
		if (c.subtitle ?? "").range(of: "direct message", options: .caseInsensitive) != nil { signals.append("direct message"); score += 15 }
		else { signals.append("mentions the user"); score += 10 }
		if c.title.contains("?") { signals.append("asks a question"); score += 10 }
		if let at = c.timestamp.flatMap(TodoRecurrence.parseISO) {
			let age = now.timeIntervalSince(at)
			if age > 3 * day { return nil }
			if age <= 2 * hour { signals.append("in the last 2 hours"); score += 15 }
			else if age <= day { signals.append("today"); score += 5 }
			else { signals.append("\(FeedText.plural(Int(age / day), "day")) ago"); score -= 10 }
		}
		return (score, signals)
	}

	static func scoreNews(_ c: FeedCandidate, now: Date) -> (Double, [String])? {
		var signals = ["news headline"]
		var score: Double = 5
		if let at = c.timestamp.flatMap(TodoRecurrence.parseISO) {
			if now.timeIntervalSince(at) > day { return nil }
			if now.timeIntervalSince(at) <= 3 * hour { signals.append("published in the last 3 hours"); score += 5 }
		}
		return (score, signals)
	}

	public static func normalizeFeedbackTitle(_ title: String) -> String {
		let lowered = title.lowercased().replacing(/\d+/, with: " ")
		let lettersOnly = String(lowered.unicodeScalars.map { CharacterSet.letters.contains($0) || CharacterSet.whitespaces.contains($0) ? Character($0) : " " })
		return lettersOnly.split(whereSeparator: \.isWhitespace).joined(separator: " ")
	}

	public static func feedbackKey(category: String, providerName: String, title: String?, subtitle: String?) -> String? {
		if ["calendar", "tasks", "todos"].contains(category) {
			let normalized = title.map(normalizeFeedbackTitle) ?? ""
			return normalized.isEmpty ? nil : "\(category):\(providerName):title:\(normalized)"
		}
		guard let subtitle = subtitle?.trimmingCharacters(in: .whitespaces).lowercased(), !subtitle.isEmpty else { return nil }
		var source = subtitle
		if category == "email" {
			if let match = subtitle.firstMatch(of: /<([^>]+)>/) { source = String(match.1) }
		} else if category == "chat" {
			let parts = subtitle.split(separator: "·").map { $0.trimmingCharacters(in: .whitespaces) }
			source = parts.count > 1 && parts[1].hasPrefix("#") ? parts[1] : (parts.first ?? subtitle)
		}
		return "\(category):\(providerName):\(source)"
	}

	public static func prefilter(_ raw: [FeedCandidate], now: Date = Date(), feedback: [String: Int] = [:]) -> [FeedCandidate] {
		var seen = Set<String>()
		var scored: [FeedCandidate] = []
		for var c in raw where seen.insert(c.id).inserted {
			let result: (Double, [String])? = switch c.category {
			case "calendar": scoreCalendar(c, now: now)
			case "email": scoreEmail(c, now: now)
			case "tasks", "todos": scoreTask(c, now: now)
			case "chat": scoreChat(c, now: now)
			case "news": scoreNews(c, now: now)
			default: nil
			}
			guard let (score, signals) = result else { continue }
			c.signals = signals
			c.score = score
			if let key = feedbackKey(category: c.category, providerName: c.providerName, title: c.title, subtitle: c.subtitle), let n = feedback[key], n > 0 {
				c.score += n >= 2 ? -30 : -15
				c.signals.append("the user marked \(FeedText.plural(n, "similar item")) from this source not relevant")
			}
			scored.append(c)
		}
		scored.sort { $0.score != $1.score ? $0.score > $1.score : $0.id < $1.id }
		var perCategory: [String: Int] = [:]
		var bulk = 0
		var out: [FeedCandidate] = []
		for c in scored {
			let n = perCategory[c.category] ?? 0
			if n >= (maxFor[c.category] ?? maxPerCategory) { continue }
			if c.category == "email", isBulkEmail(c) {
				if bulk >= maxBulkEmails { continue }
				bulk += 1
			}
			perCategory[c.category] = n + 1
			out.append(c)
			if out.count >= maxCandidates { break }
		}
		return out
	}

	public static func signature(_ candidates: [FeedCandidate], extra: [String]) -> String {
		var text = extra.map { "\($0)\n" }.joined()
		for c in candidates.sorted(by: { $0.id < $1.id }) {
			let facts = [c.event, c.email, c.task].map { $0.map { $0.isNull ? "" : $0.jsonString() } ?? "" }
			text += "\(c.cardID ?? c.id)|\(c.id)|\(c.title)|\(c.timestamp ?? "")|\(c.dueDate ?? "")|\(c.urgency ?? "")|\(facts.joined(separator: "|"))\n"
		}
		return String(FeedText.sha(text).prefix(32))
	}
}

// MARK: Instruction filters (port of `feed/instruction-filters.ts`)

public enum FeedRules {
	static let compilerVersion = "rules-v1"

	public static func hash(_ text: String) -> String {
		String(FeedText.sha("\(compilerVersion)|\(text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())").prefix(16))
	}

	static func norm(_ value: String?) -> String { (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

	static func strings(_ value: JSONValue?) -> [String] { (value?.arrayValue ?? []).compactMap(\.stringValue) }

	public static func isMeaningful(_ filter: JSONValue) -> Bool {
		!strings(filter["categories"]).isEmpty || !strings(filter["providers"]).isEmpty
			|| (filter["listMode"]?.stringValue ?? "any" != "any" && !strings(filter["lists"]).isEmpty)
			|| (filter["assignmentMode"]?.stringValue ?? "any" != "any" && !strings(filter["assignments"]).isEmpty)
	}

	/// Whether a filter hides an item. Missing facts never hide.
	public static func matches(_ filter: JSONValue, category: String, providerName: String, providerDisplayName: String?, subtitle: String?, task: JSONValue?) -> Bool {
		guard isMeaningful(filter) else { return false }
		let categories = strings(filter["categories"])
		if !categories.isEmpty, !categories.contains(category) { return false }
		let providers = strings(filter["providers"])
		if !providers.isEmpty {
			let names = [norm(providerName), norm(providerDisplayName)]
			if !providers.contains(where: { names.contains(norm($0)) }) { return false }
		}
		let listMode = filter["listMode"]?.stringValue ?? "any"
		let lists = strings(filter["lists"])
		if listMode != "any", !lists.isEmpty {
			let list = norm(subtitle)
			if list.isEmpty { return false }
			let listed = lists.contains { norm($0) == list }
			if listMode == "in" ? !listed : listed { return false }
		}
		let assignmentMode = filter["assignmentMode"]?.stringValue ?? "any"
		let assignments = strings(filter["assignments"])
		if assignmentMode != "any", !assignments.isEmpty {
			let listed = assignments.contains(task?["assignment"]?.stringValue ?? "you")
			if assignmentMode == "in" ? !listed : listed { return false }
		}
		return true
	}

	public static func active(_ instructions: [JSONValue]) -> [JSONValue] {
		instructions.flatMap { instruction -> [JSONValue] in
			guard instruction["enabled"] != false, let rule = instruction["rule"], rule["status"] == "filter",
			      rule["hash"]?.stringValue == hash(instruction["text"]?.stringValue ?? "") else { return [] }
			return rule["filters"]?.arrayValue ?? []
		}
	}

	public static func apply(_ candidates: [FeedCandidate], _ filters: [JSONValue]) -> [FeedCandidate] {
		guard !filters.isEmpty else { return candidates }
		return candidates.filter { c in !filters.contains { matches($0, category: c.category, providerName: c.providerName, providerDisplayName: c.providerDisplayName, subtitle: c.subtitle, task: c.task) } }
	}

	static let compileSchema: JSONSchema = .object([
		"filters": .array(.object([
			"categories": .array(.string(enum: ["email", "calendar", "tasks", "todos", "chat", "news"]), description: "Categories this filter applies to; empty means any category"),
			"providers": .array(.string(), description: "Provider ids from the list given; empty means any provider"),
			"listMode": .string(description: "Match on the item's list/project/sender ('from/list'): any = ignore it", enum: ["any", "in", "not_in"]),
			"lists": .array(.string(), description: "List/project names for listMode"),
			"assignmentMode": .string(description: "Match on who a task is assigned to: any = ignore it", enum: ["any", "in", "not_in"]),
			"assignments": .array(.string(enum: ["you", "someone_else", "unassigned"]), description: "Assignees for assignmentMode; 'you' is the user"),
		]), description: "Hide a candidate that matches every condition of any one filter. Empty when the instruction does not leave anything out, or can't be expressed with these fields."),
		"summary": .string(description: "Short plain sentence of what the filters hide, e.g. 'Hides reminders outside the Errands list'. Empty when filters is empty."),
	])

	static func compilePrompt(_ text: String, candidates: [FeedCandidate]) -> String {
		var providers: [String: (id: String, display: String?, category: String, lists: Set<String>)] = [:]
		for c in candidates {
			let key = "\(c.category):\(c.providerName)"
			var entry = providers[key] ?? (c.providerName, c.providerDisplayName, c.category, [])
			if let subtitle = c.subtitle?.trimmingCharacters(in: .whitespaces), !subtitle.isEmpty, entry.lists.count < 40 { entry.lists.insert(subtitle) }
			providers[key] = entry
		}
		let lines = providers.values.sorted { $0.id < $1.id }.map { p in
			"- \(p.id)\(p.display.map { " (\"\($0)\")" } ?? "") [\(p.category)]\(p.lists.isEmpty ? "" : " lists seen: \(p.lists.sorted().joined(separator: ", "))")"
		}
		return """
		Turn this user instruction for The Feed into filters that hide items.
		Instruction: "\(text)"
		Connected sources:
		\(lines.isEmpty ? "(none connected right now)" : lines.joined(separator: "\n"))
		Candidate fields you can filter on:
		- category: one of email, calendar, tasks, todos, chat, news
		- provider: a provider id above (match the user's wording, e.g. "Reminders" → applereminders)
		- list: the item's list/project (tasks), folder or sender (email), or calendar name
		- assignment (tasks in shared projects): you, someone_else, unassigned. Items with no assignment info count as "you".
		Rules:
		- Only produce filters for parts that leave items OUT ("ignore", "skip", "hide", "only show"). "Only show X" becomes a filter that hides everything that is not X.
		- Ordering, priority, or emphasis ("put X first", "X matters most") produce no filter.
		- Keep each filter as narrow as the instruction says: if it names a source, set providers; don't widen to other sources.
		- When the instruction can't be expressed with these fields, return no filters.
		- Use list names exactly as listed when one matches the user's wording.
		"""
	}

	/// Compile one instruction into a rule (`filter`, `guidance`, or `failed`).
	static func compile(_ text: String, candidates: [FeedCandidate], model: LanguageModel, now: Date) async -> JSONValue {
		let at = TodoRecurrence.isoString(now)
		let ruleHash = hash(text)
		do {
			let output = try await generateJSON(ObjectRequest(
				model: model,
				instructions: "You convert short natural-language rules into precise structured filters. Be literal; never invent conditions the user did not state.",
				messages: [.user(compilePrompt(text, candidates: candidates))],
				schema: compileSchema, schemaName: "FeedRuleFilters", schemaDescription: "Filters that hide Feed candidates",
				temperature: 0, maxOutputTokens: 1000,
			)).object
			let filters = (output["filters"]?.arrayValue ?? []).filter(isMeaningful)
			if filters.isEmpty { return ["status": "guidance", "hash": .string(ruleHash), "at": .string(at)] }
			let summary = output["summary"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? "Hides matching items"
			return ["status": "filter", "hash": .string(ruleHash), "at": .string(at), "filters": .array(filters), "summary": .string(summary)]
		} catch {
			return ["status": "failed", "hash": .string(ruleHash), "at": .string(at), "error": .string(String(error.localizedDescription.prefix(300)))]
		}
	}
}
