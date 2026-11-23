import Foundation
import GRDB
import TobyAI
import TobyCore
import TobyStore

// Seed a Toby home with generic, non-personal sample data for docs and
// screenshots: chats, memories, projects, flows (with run history), todos,
// skills, recordings, and personas. Writes the native database directly.
//
// Usage:
//   swift run --package-path apps/toby-app toby-seed [FOLDER] [--allow-default-home]
//   (default FOLDER: ~/.toby-generic; the folder is wiped first)
//
// No secrets are written: Keychain items are shared by every Toby home, so
// Mail, Slack, and OpenRouter keep whatever this Mac already has.

let now = ISO8601DateFormatter().date(from: "2026-07-10T15:30:00Z")!
@MainActor func iso(_ date: Date) -> String { TodoRecurrence.isoString(date) }
@MainActor func daysAgo(_ days: Double) -> Date { now.addingTimeInterval(-days * 86400) }

func fail(_ message: String) -> Never {
	FileHandle.standardError.write(Data("\(message)\n".utf8))
	exit(1)
}

// MARK: Arguments

var positional: String?
var allowDefaultHome = false
for argument in CommandLine.arguments.dropFirst() {
	switch argument {
	case "-h", "--help":
		print("Usage: toby-seed [FOLDER] [--allow-default-home]\n\nPopulate FOLDER (default ~/.toby-generic) with a generic Toby home. The folder is wiped first.")
		exit(0)
	case "--allow-default-home": allowDefaultHome = true
	case "--force", "--no-source": continue // accepted for compatibility with the old script
	default:
		if argument.hasPrefix("-") { fail("Unknown option: \(argument)") }
		if positional != nil { fail("Unexpected argument: \(argument)") }
		positional = argument
	}
}

let home = FileManager.default.homeDirectoryForCurrentUser
let destination = URL(fileURLWithPath: ((positional ?? home.appending(path: ".toby-generic").path) as NSString).expandingTildeInPath).standardizedFileURL
if destination.path == home.appending(path: ".toby").standardizedFileURL.path, !allowDefaultHome {
	fail("Refusing to seed the real default home (\(destination.path)). Pick another folder, or pass --allow-default-home.")
}

let fm = FileManager.default
print("Seeding generic Toby home\n  dest: \(destination.path)")
if fm.fileExists(atPath: destination.path) {
	print("  note: wiping existing contents")
	try fm.removeItem(at: destination)
}
try fm.createDirectory(at: destination, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

@MainActor func write(_ text: String, to relative: String) throws {
	let url = destination.appending(path: relative)
	try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
	try Data(text.utf8).write(to: url)
}

@MainActor func writeJSON(_ value: JSONValue, to relative: String) throws {
	var data = try JSONEncoder.tobyPretty.encode(value)
	data.append(10)
	let url = destination.appending(path: relative)
	try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
	try data.write(to: url)
}

// MARK: Config (personas, chat replies, recordings)

let chatModel = ModelDefaults.chat
let personas: [JSONValue] = [
	["name": "Audrey", "promptMode": "add", "ai": ["provider": "openrouter", "model": .string(chatModel)],
	 "instructions": "You help triage email and tasks into urgency categories: Immediate Need, Short-term Planning, and You Can Ignore. Be decisive and structured."],
	["name": "Planner", "promptMode": "add", "ai": ["provider": "openrouter", "model": .string(chatModel)],
	 "instructions": "You help with calendars, agendas, and weekly planning. Call out conflicts and suggest preparation for important meetings."],
]
try writeJSON([
	"personas": .array(personas),
	"defaultPersona": "Toby",
	"chatInbound": ["enabled": false, "integration": "slack", "persona": "Planner"],
	"listen": ["deleteAudioAfterTranscription": false, "recordMic": true, "recordSystem": true],
], to: "config.json")

// MARK: Database

let paths = TobyPaths(root: destination)
let database = try TobyDatabase.open(paths: paths)
let writer = database.writer
// Mark the (empty) legacy import complete so the app doesn't look for old files.
_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run()

@MainActor func setTimes(_ table: String, id: String, created: Date, updated: Date) throws {
	try writer.write { db in
		try db.execute(sql: "UPDATE \(table) SET created_at = ?, updated_at = ? WHERE id = ?", arguments: [iso(created), iso(updated), id])
	}
}

// Memories
let memoryService = MemoryService(writer: writer)
let memories: [(String, String, String, Double)] = [
	("fact", "identity", "User's name is Alex Rivera.", 1.0),
	("preference", "Work style", "Prefers bullet-point summaries and morning briefings before 9 AM.", 0.95),
	("fact", "employment", "Works as a product designer at Northstar Labs, focused on mobile apps.", 1.0),
	("preference", "Meetings", "Prefers no meetings before 10 AM and keeps Fridays free for deep work.", 0.9),
	("fact", "timezone", "Usually works in America/New_York timezone.", 0.85),
]
for (index, memory) in memories.enumerated() {
	let created = try await memoryService.createManual(.init(type: memory.0, subject: memory.1, value: memory.2, confidence: memory.3))
	if let id = created["memory"]?["id"]?.stringValue ?? created["id"]?.stringValue {
		try setTimes("memory_items", id: id, created: daysAgo(Double(10 - index)), updated: daysAgo(Double(10 - index)))
	}
}

// Projects
let projects = ProjectService(writer: writer, tobyDirectory: destination)
let weekly = try projects.create(name: "Weekly Planning", summary: "Track goals, agendas, and status updates for the week.", personaName: "Planner")
let launch = try projects.create(name: "Product Launch", summary: "Launch checklist, messaging, and rollout notes for the new release.", personaName: "Toby")
for (project, agents, output, body) in [
	(weekly, "Focus on weekly goals, agenda prep, and short status updates.\nPrefer calendars and task lists as sources of truth.\n",
	 "week-overview.md", "# Week overview\n\n- Ship onboarding polish\n- Design review prep\n- Backlog triage\n"),
	(launch, "Track launch readiness: messaging, checklists, and rollout notes.\nKeep customer-facing copy clear and concise.\n",
	 "launch-checklist.md", "# Launch checklist\n\n- [x] Feature freeze\n- [ ] Store screenshots\n- [ ] Support macros\n- [ ] Release email\n"),
] {
	try Data("# Project Instructions\n\n\(agents)".utf8).write(to: URL(fileURLWithPath: project.folderPath).appending(path: "AGENTS.md"))
	try Data(body.utf8).write(to: URL(fileURLWithPath: project.outputsDir).appending(path: output))
	try setTimes("projects", id: project.id, created: daysAgo(14), updated: now)
}

// Chats
let sessions = ChatSessionStore(writer: writer)
@MainActor func addSession(_ name: String, daysAgo days: Double, project: String? = nil, turns: [(user: String, assistant: String)]) throws {
	let created = try sessions.create(name: name, settings: project.map { ["projectId": .string($0)] })
	let id = created["id"]!.stringValue!
	var reducer = ChatTranscript.Reducer()
	var messages: [Message] = []
	for (index, turn) in turns.enumerated() {
		reducer.addUser(turn.user, createdAt: iso(daysAgo(days)))
		let segment = JSONValue.string("seed-\(index)")
		reducer.apply(["type": "assistant_segment_start", "id": segment])
		reducer.apply(["type": "assistant_text_delta", "id": segment, "delta": .string(turn.assistant)])
		reducer.apply(["type": "assistant_segment_end", "id": segment])
		messages += [.user(turn.user), .assistant(turn.assistant)]
	}
	if !messages.isEmpty {
		try sessions.saveTurn(id, messages: messages, transcript: reducer.entries, transcriptFrom: 0, contextWindow: nil)
	}
	try setTimes("chat_sessions", id: id, created: daysAgo(days), updated: daysAgo(days).addingTimeInterval(300))
}

try addSession("New chat", daysAgo: 0.1, turns: [])
try addSession("Morning briefing", daysAgo: 0.5, turns: [(
	"How are you today? Give me a short morning check-in.",
	"Good morning! I'm ready to help. Here's a quick check-in:\n\n- **Calendar:** 2 meetings after 11 AM, open morning for focus work\n- **Tasks:** 3 open items due this week\n- **Inbox:** A few unread messages worth a skim\n\nWant me to expand any of those?"
)])
try addSession("Weather check", daysAgo: 1, turns: [(
	"What's the weather looking like this afternoon?",
	"This afternoon looks **partly cloudy**, around **74°F**, with a light breeze. A good day for a walk between meetings. I can set a reminder if the forecast changes."
)])
try addSession("Unread email summary", daysAgo: 2, turns: [(
	"Summarize my unread email that needs a reply.",
	"Here's a concise triage of unread mail that needs attention:\n\n1. **Acme Design review** — feedback requested by Friday\n2. **Vendor quote follow-up** — waiting on your approval\n3. **Team offsite poll** — pick dates this week\n\nEverything else looks low priority or automated."
)])
try addSession("Art history question", daysAgo: 3, turns: [(
	"Can you remember that I prefer bullet summaries for art write-ups?",
	"Got it — I'll use bullet summaries for art write-ups going forward. I've saved that as a preference."
)])
try addSession("Launch checklist chat", daysAgo: 1.5, project: launch.id, turns: [(
	"What should we still finish for the product launch?",
	"Launch remaining items:\n\n- Finalize store screenshots\n- Confirm support macros for day-one issues\n- Schedule the customer email for release day\n- Double-check feature flags in staging\n\nI can draft the customer email next if you want."
)])
try addSession("Weekly goals", daysAgo: 4, project: weekly.id, turns: [(
	"Draft my weekly goals overview.",
	"## This week's focus\n\n- Ship the onboarding polish PR\n- Prep design review for navigation\n- Clear backlog triage on Wednesday\n\nI'll keep this project folder updated as you check things off."
)])

// Flows (scheduled) and run history
@MainActor func flowDocument(name: String, description: String, persona: String, cron: String, prompt: String) -> JSONValue {
	[
		"name": .string(name), "description": .string(description), "icon": "sparkles", "persona": .string(persona),
		"triggers": [
			["id": "manual", "name": "Manually", "enabled": true, "source": ["type": "manual"]],
			["id": "schedule", "name": "On a schedule", "enabled": true, "source": ["type": "schedule", "cron": .string(cron), "missedRuns": "latest"]],
		],
		"nodes": [["id": "write", "type": "llm_prompter", "systemPrompt": "Reply with markdown only.", "userPrompt": .string(prompt), "outputs": ["summary": "markdown"]]],
	]
}
let inboxFlow = try writer.write { db in
	try FlowDocuments.save(db, try FlowDocuments.parse(flowDocument(
		name: "Morning Inbox Check", description: "Summarize unread mail into three urgency buckets.", persona: "Audrey", cron: "0 9 * * *",
		prompt: "Scan the inbox for unread messages from the last 24 hours. Summarize anything that needs a reply today in three urgency buckets."
	), id: "flow.morning-inbox-check"))
}
_ = try writer.write { db in
	try FlowDocuments.save(db, try FlowDocuments.parse(flowDocument(
		name: "Friday weekly recap", description: "Recap completed tasks and open loops for Monday.", persona: "Planner", cron: "0 16 * * 5",
		prompt: "Draft a short weekly recap of completed tasks and open loops for Monday."
	), id: "flow.friday-weekly-recap"))
}
let runOutput = "## Morning inbox summary\n\n### Immediate need\n- Design review feedback requested for the checkout flow\n\n### Short-term planning\n- Vendor renewal discussion next week\n\n### You can ignore\n- Newsletter digests and automated receipts\n"
try writer.write { db in
	for day in 1 ... 5 {
		let started = daysAgo(Double(day)).addingTimeInterval(-6 * 3600)
		try db.execute(sql: """
		INSERT INTO flow_runs (id, flow_name, status, persona_name, provider, model, trigger, definition_snapshot_json, initial_inputs_json, final_outputs_json, started_at, completed_at, duration_ms)
		VALUES (?, ?, 'success', 'Audrey', 'openrouter', ?, 'schedule:schedule', ?, '{}', ?, ?, ?, 12000)
		""", arguments: [UUID().uuidString.lowercased(), inboxFlow.id, chatModel, JSONValue.object(inboxFlow.document).jsonString(),
		                 JSONValue.object(["summary": .object(["markdown": .string(runOutput)])]).jsonString(), iso(started), iso(started.addingTimeInterval(12))])
	}
}

// Todos
let todos = TodoService(writer: writer, tobyDirectory: destination)
for (title, due, notes) in [
	("Send design review notes to Acme", "2026-07-11", "Feedback requested by Friday."),
	("Approve vendor quote", "2026-07-13", "Waiting on budget sign-off."),
	("Pick team offsite dates", "2026-07-15", ""),
] {
	var todo: [String: JSONValue] = ["title": .string(title), "due": ["date": .string(due)]]
	if !notes.isEmpty { todo["description"] = .string(notes) }
	_ = try todos.create(.object(todo), context: TodoMutationContext(source: "seed"))
}

// MARK: Skills

let skills: [(String, String)] = [
	("organize-unread-emails", "---\nname: organize-unread-emails\ndescription: Organize unread email into urgency categories with suggested actions.\n---\n\n# Organize unread emails\n\n1. Sync the mailbox and list unread messages from the last 7 days.\n2. Group into **Immediate need**, **Short-term planning**, and **You can ignore**.\n3. Suggest one clear next action per message.\n4. Ask before sending replies or archiving.\n"),
	("todays-agenda", "---\nname: Todays Agenda\ndescription: Brief overview of today's calendar and high-priority tasks.\n---\n\n# Today's agenda\n\n1. Load today's calendar; skip low-value blocks like generic focus placeholders.\n2. Highlight conflicts and suggest which meeting to prioritize.\n3. List top open tasks due today.\n4. Output sections: **High priority**, **Conflicts**, **Other**.\n"),
	("weekly-update", "---\nname: Weekly Update\ndescription: Draft a weekly status update from tasks and calendar activity.\n---\n\n# Weekly update\n\nProduce a short status document with:\n\n## Overview\nOne paragraph on themes for the week.\n\n## Completed\nBullet list of finished work.\n\n## Next week\nTop 3 priorities.\n"),
]
for (folder, body) in skills { try write(body, to: "skills/\(folder)/SKILL.md") }

// MARK: Recordings (from scripts/fixtures/listen-recordings.zip)

let repoRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appending(path: "../../../..").standardizedFileURL
let fixtures = repoRoot.appending(path: "scripts/fixtures/listen-recordings.zip")
guard fm.fileExists(atPath: fixtures.path) else { fail("Recording fixtures missing at \(fixtures.path)") }
let recordings = paths.listenRecordings
try fm.createDirectory(at: recordings, withIntermediateDirectories: true)
let unzip = Process()
unzip.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
unzip.arguments = ["-oq", fixtures.path, "-d", recordings.path]
try unzip.run()
unzip.waitUntilExit()
guard unzip.terminationStatus == 0 else { fail("unzip failed for \(fixtures.path)") }
let defaults = ["combined": "combined.m4a", "mic": "mic.wav", "system": "system.wav", "transcript": "transcript.txt", "transcriptJson": "transcript.json", "summary": "summary.md"]
for id in try fm.contentsOfDirectory(atPath: recordings.path).filter({ !$0.hasPrefix(".") }).sorted() {
	let dir = recordings.appending(path: id)
	let metaURL = dir.appending(path: "metadata.json")
	guard var meta = (try? Data(contentsOf: metaURL)).flatMap({ try? JSONDecoder().decode(JSONValue.self, from: $0) })?.objectValue else {
		fail("Recording fixture \(id) is missing metadata.json")
	}
	var files = meta["files"]?.objectValue ?? [:]
	for (key, value) in files { if let text = value.stringValue { files[key] = .string((text as NSString).lastPathComponent) } }
	for (key, name) in defaults where fm.fileExists(atPath: dir.appending(path: name).path) { files[key] = .string(name) }
	if meta["id"]?.stringValue?.isEmpty ?? true { meta["id"] = .string(id) }
	meta["files"] = .object(files)
	try ListenService.writeMetadata(dir, meta)
}

try write("""
# Toby generic home (docs / screenshots)

A non-personal Toby home generated by `toby-seed` (apps/toby-app/Sources/TobySeed).
It does not replace `~/.toby`.

    bun run app:screenshots          # seed if needed, build Dev, launch with this home
    bun run app:screenshots -- --reseed

Contents: chats, memories, projects, scheduled flows with run history, todos,
skills, and recordings (from scripts/fixtures/listen-recordings.zip).
No secrets are written; Mail, Slack, and OpenRouter use this Mac's Keychain.
""", to: "README.md")

print("Done.\n  database: \(paths.database.path)\n\nUse it: TOBY_DIR=\"\(destination.path)\" open -n \"dist/Toby (Dev).app\"   (or bun run app:screenshots)")
