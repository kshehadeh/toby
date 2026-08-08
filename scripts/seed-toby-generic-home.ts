#!/usr/bin/env bun
/**
 * Seed a Toby data home with generic sample data (chats, memories, projects, …).
 *
 * Populates a folder you specify as a full Toby home (config, credentials,
 * SQLite DBs, skills, recordings). Optionally copies integration connection
 * flags from an existing home (default: ~/.toby) so Integrations look connected;
 * user-specific content is always replaced with demos. The source is never modified.
 *
 * Usage:
 *   bun scripts/seed-toby-generic-home.ts ~/Desktop/toby-demo
 *   bun scripts/seed-toby-generic-home.ts /path/to/my-sample-home
 *   bun scripts/seed-toby-generic-home.ts
 *   bun scripts/seed-toby-generic-home.ts --dest ~/.toby-generic
 *   bun scripts/seed-toby-generic-home.ts ~/demo --no-source
 *
 * Launch:
 *   bun run app:screenshots
 *   TOBY_DIR="/path/to/home" TOBY_CREDENTIALS_KEY_BACKEND=plaintext bun run app
 *   # or Settings → General → Home directory → Choose… the folder
 */

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOW = new Date(Date.UTC(2026, 6, 10, 15, 30, 0));

// ─── helpers ────────────────────────────────────────────────────────────────

function iso(dt: Date): string {
	return dt.toISOString();
}

function uid(): string {
	return randomUUID();
}

function addMs(dt: Date, ms: number): Date {
	return new Date(dt.getTime() + ms);
}

function addDays(dt: Date, days: number): Date {
	return addMs(dt, days * 86_400_000);
}

function addMinutes(dt: Date, minutes: number): Date {
	return addMs(dt, minutes * 60_000);
}

function addHours(dt: Date, hours: number): Date {
	return addMs(dt, hours * 3_600_000);
}

function resolvePath(p: string): string {
	return path.resolve(
		p.startsWith("~") ? p.replace(/^~(?=$|[/\\])/, os.homedir()) : p,
	);
}

function ensureCleanDest(dest: string): void {
	if (fs.existsSync(dest)) {
		fs.rmSync(dest, { recursive: true, force: true });
	}
	fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
}

function writeJson(filePath: string, data: unknown, mode = 0o600): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, {
		encoding: "utf-8",
		mode,
	});
}

function writeText(filePath: string, text: string, mode = 0o644): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, text, { encoding: "utf-8", mode });
}

function chmodSafe(filePath: string, mode: number): void {
	try {
		fs.chmodSync(filePath, mode);
	} catch {
		// ignore (e.g. unsupported on some volumes)
	}
}

// ─── config / credentials ───────────────────────────────────────────────────

function copyConfig(source: string, dest: string): void {
	const srcCfgPath = path.join(source, "config.json");
	let base: Record<string, unknown> = {};
	if (fs.existsSync(srcCfgPath)) {
		try {
			base = JSON.parse(fs.readFileSync(srcCfgPath, "utf-8")) as Record<
				string,
				unknown
			>;
		} catch {
			base = {};
		}
	}

	const integrations = (base.integrations as Record<string, unknown>) ?? {};
	const connected: Record<string, Record<string, unknown>> = {};
	for (const [name, meta] of Object.entries(integrations)) {
		if (meta && typeof meta === "object" && !Array.isArray(meta)) {
			const m = meta as Record<string, unknown>;
			const kept: Record<string, unknown> = {};
			for (const k of [
				"connectedAt",
				"pluginVersion",
				"inboundEnabled",
			] as const) {
				if (k in m) kept[k] = m[k];
			}
			if (Object.keys(kept).length > 0) connected[name] = kept;
		}
	}

	const defaultConnected = {
		email: { connectedAt: iso(addDays(NOW, -5)), pluginVersion: "1.0.0" },
		applecalendar: {
			connectedAt: iso(addDays(NOW, -4)),
			pluginVersion: "1.1.0",
		},
		todoist: { connectedAt: iso(addDays(NOW, -3)), pluginVersion: "1.0.0" },
		slack: {
			connectedAt: iso(addDays(NOW, -2)),
			pluginVersion: "1.0.0",
			inboundEnabled: true,
		},
		macos: { connectedAt: iso(addDays(NOW, -10)), pluginVersion: "1.1.0" },
	};

	const config = {
		integrations:
			Object.keys(connected).length > 0 ? connected : defaultConnected,
		personas: [
			{
				name: "Toby",
				instructions:
					"You are Toby, a friendly personal assistant. Be concise, practical, " +
					"and proactive about next steps. Prefer clear bullet lists for multi-step work.",
				promptMode: "add",
				ai: { provider: "openai", model: "gpt-5-mini" },
			},
			{
				name: "Audrey",
				instructions:
					"You help triage email and tasks into urgency categories: " +
					"Immediate Need, Short-term Planning, and You Can Ignore. " +
					"Be decisive and structured.",
				promptMode: "add",
				ai: { provider: "openai", model: "gpt-5-mini" },
			},
			{
				name: "Planner",
				instructions:
					"You help with calendars, agendas, and weekly planning. " +
					"Call out conflicts and suggest preparation for important meetings.",
				promptMode: "add",
				ai: { provider: "openai", model: "gpt-5-mini" },
			},
		],
		defaultPersona: "Toby",
		defaultProviders: (base.defaultProviders as Record<string, string>) ?? {
			email: "email",
			calendar: "applecalendar",
			tasks: "todoist",
			contacts: "applecontacts",
			chat: "slack",
			documents: "notion",
			work_tracker: "jira",
		},
		chatInbound: {
			enabled: true,
			integration: "slack",
			persona: "Planner",
		},
		transcription: (base.transcription as Record<string, unknown>) ?? {
			provider: "openai",
			model: "gpt-4o-transcribe",
		},
		webSearch: (base.webSearch as Record<string, unknown>) ?? {
			provider: "ai-gateway",
			enabled: true,
		},
		weather: (base.weather as Record<string, unknown>) ?? {
			enabled: true,
			temperatureUnit: "fahrenheit",
		},
		dashboard: { persona: "Toby" },
	};
	writeJson(path.join(dest, "config.json"), config, 0o600);
}

function writeCredentials(dest: string): void {
	const creds = {
		integrations: {
			email: {
				fromAddress: "alex@example.com",
				fromName: "Alex Rivera",
				imapHost: "imap.example.com",
				imapPort: "993",
				imapUser: "alex@example.com",
				imapPassword: "demo-password-not-real",
				imapTls: "true",
				smtpHost: "smtp.example.com",
				smtpPort: "587",
				smtpUser: "alex@example.com",
				smtpPassword: "demo-password-not-real",
			},
			todoist: { apiToken: "demo-todoist-token" },
			slack: {
				botToken: "xoxb-demo-not-real",
				appToken: "xapp-demo-not-real",
			},
			jira: {
				baseUrl: "https://example.atlassian.net",
				email: "alex@example.com",
				apiToken: "demo-jira-token",
			},
			notion: { apiKey: "secret_demo_notion" },
		},
		ai: {
			openai: { apiKey: "sk-demo-openai-not-real" },
			vercel: { apiKey: "vck_demo_vercel_not_real" },
		},
		transcription: { openai: { apiKey: "sk-demo-transcription-not-real" } },
	};
	writeJson(path.join(dest, "credentials.json"), creds, 0o600);
}

// ─── memory.sqlite ──────────────────────────────────────────────────────────

function seedMemoryDb(dest: string): void {
	const dbPath = path.join(dest, "memory.sqlite");
	if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

	const db = new Database(dbPath);
	db.exec(`
		CREATE TABLE memory_items (
		  id TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL,
		  type TEXT NOT NULL,
		  subject TEXT,
		  value TEXT NOT NULL,
		  confidence REAL NOT NULL DEFAULT 0.5,
		  sensitivity TEXT NOT NULL DEFAULT 'normal',
		  visibility TEXT NOT NULL DEFAULT 'usable_by_ai',
		  expires_at TEXT,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL
		);
		CREATE TABLE memory_sources (
		  id TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL,
		  system TEXT NOT NULL,
		  source_id TEXT,
		  source_url TEXT,
		  observed_at TEXT NOT NULL,
		  excerpt TEXT,
		  metadata_json TEXT
		);
		CREATE TABLE memory_item_sources (
		  memory_id TEXT NOT NULL,
		  source_id TEXT NOT NULL,
		  PRIMARY KEY (memory_id, source_id)
		);
		CREATE TABLE memory_proposals (
		  id TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'pending',
		  candidate_json TEXT NOT NULL,
		  source_id TEXT NOT NULL,
		  confidence REAL NOT NULL,
		  sensitivity TEXT NOT NULL,
		  suggested_visibility TEXT NOT NULL,
		  reason TEXT NOT NULL,
		  rejection_reason TEXT,
		  created_at TEXT NOT NULL,
		  resolved_at TEXT
		);
		CREATE TABLE memory_embeddings (
		  memory_id TEXT PRIMARY KEY,
		  embedding_blob BLOB NOT NULL,
		  model TEXT NOT NULL,
		  created_at TEXT NOT NULL
		);
		CREATE TABLE memory_audit_log (
		  id TEXT PRIMARY KEY,
		  user_id TEXT NOT NULL,
		  memory_id TEXT,
		  action TEXT NOT NULL,
		  detail_json TEXT,
		  created_at TEXT NOT NULL
		);
	`);

	const memories: Array<[string, string, string, number]> = [
		["fact", "identity", "User's name is Alex Rivera.", 1.0],
		[
			"preference",
			"Work style",
			"Prefers bullet-point summaries and morning briefings before 9 AM.",
			0.95,
		],
		[
			"fact",
			"employment",
			"Works as a product designer at Northstar Labs, focused on mobile apps.",
			1.0,
		],
		[
			"preference",
			"Meetings",
			"Prefers no meetings before 10 AM and keeps Fridays free for deep work.",
			0.9,
		],
		["fact", "timezone", "Usually works in America/New_York timezone.", 0.85],
	];

	const insertSource = db.prepare(
		`INSERT INTO memory_sources
		 (id, user_id, system, source_id, source_url, observed_at, excerpt, metadata_json)
		 VALUES (?, 'default', 'manual', NULL, NULL, ?, NULL, NULL)`,
	);
	const insertItem = db.prepare(
		`INSERT INTO memory_items
		 (id, user_id, type, subject, value, confidence, sensitivity, visibility,
		  expires_at, created_at, updated_at)
		 VALUES (?, 'default', ?, ?, ?, ?, 'normal', 'usable_by_ai', NULL, ?, ?)`,
	);
	const insertLink = db.prepare(
		"INSERT INTO memory_item_sources (memory_id, source_id) VALUES (?, ?)",
	);
	const insertAudit = db.prepare(
		`INSERT INTO memory_audit_log
		 (id, user_id, memory_id, action, detail_json, created_at)
		 VALUES (?, 'default', ?, 'created', NULL, ?)`,
	);

	const tx = db.transaction(() => {
		for (const [i, memory] of memories.entries()) {
			const [typ, subject, value, conf] = memory;
			const mid = uid();
			const sid = uid();
			const created = iso(addDays(NOW, -(10 - i)));
			insertSource.run(sid, created);
			insertItem.run(mid, typ, subject, value, conf, created, created);
			insertLink.run(mid, sid);
			insertAudit.run(uid(), mid, created);
		}
	});
	tx();
	db.close();
	chmodSafe(dbPath, 0o600);
}

// ─── chat.sqlite ────────────────────────────────────────────────────────────

type ProjectIds = {
	weekly: string;
	launch: string;
	weekly_path: string;
	launch_path: string;
};

function seedChatDb(dest: string): ProjectIds {
	const dbPath = path.join(dest, "chat.sqlite");
	if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

	const db = new Database(dbPath);
	db.exec(`
		CREATE TABLE chat_sessions (
		  id TEXT PRIMARY KEY,
		  name TEXT NOT NULL,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL,
		  last_pretreatment_json TEXT,
		  settings_json TEXT,
		  context_window_json TEXT,
		  project_id TEXT
		);
		CREATE TABLE chat_session_messages (
		  session_id TEXT NOT NULL,
		  idx INTEGER NOT NULL,
		  role TEXT NOT NULL,
		  content_json TEXT NOT NULL,
		  PRIMARY KEY (session_id, idx),
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
		);
		CREATE TABLE chat_session_transcript (
		  session_id TEXT NOT NULL,
		  idx INTEGER NOT NULL,
		  kind TEXT NOT NULL,
		  text TEXT NOT NULL,
		  PRIMARY KEY (session_id, idx),
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
		);
		CREATE TABLE chat_pretreatment_cache (
		  prompt_key TEXT PRIMARY KEY,
		  spec_json TEXT NOT NULL,
		  created_at TEXT NOT NULL,
		  last_hit_at TEXT
		);
		CREATE TABLE routing_embeddings (
		  entity_type TEXT NOT NULL,
		  entity_id TEXT NOT NULL,
		  catalog_signature TEXT NOT NULL,
		  model TEXT NOT NULL,
		  embedding_blob BLOB NOT NULL,
		  created_at TEXT NOT NULL,
		  PRIMARY KEY (entity_type, entity_id, catalog_signature, model)
		);
		CREATE TABLE chat_plans (
		  id TEXT PRIMARY KEY,
		  session_id TEXT NOT NULL,
		  goal TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'pending',
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL,
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
		);
		CREATE TABLE chat_plan_phases (
		  id TEXT PRIMARY KEY,
		  plan_id TEXT NOT NULL,
		  label TEXT NOT NULL,
		  description TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'pending',
		  phase_order INTEGER NOT NULL,
		  added_at TEXT NOT NULL,
		  FOREIGN KEY (plan_id) REFERENCES chat_plans(id) ON DELETE CASCADE
		);
		CREATE TABLE schedules (
		  id TEXT PRIMARY KEY,
		  name TEXT NOT NULL,
		  prompt TEXT NOT NULL,
		  persona_name TEXT NOT NULL,
		  cron_expression TEXT NOT NULL,
		  enabled INTEGER NOT NULL DEFAULT 1,
		  last_run_at TEXT,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL,
		  project_id TEXT
		);
		CREATE TABLE schedule_runs (
		  id TEXT PRIMARY KEY,
		  schedule_id TEXT NOT NULL,
		  persona_name TEXT NOT NULL,
		  prompt TEXT NOT NULL,
		  output TEXT,
		  transcript TEXT,
		  status TEXT NOT NULL DEFAULT 'pending',
		  error TEXT,
		  started_at TEXT NOT NULL,
		  completed_at TEXT,
		  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
		);
		CREATE TABLE chat_external_sessions (
		  integration TEXT NOT NULL,
		  external_key TEXT NOT NULL,
		  session_id TEXT NOT NULL,
		  display_name TEXT,
		  metadata_json TEXT,
		  awaiting_ask_user_json TEXT,
		  last_processed_message_id TEXT,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL,
		  lifecycle_status TEXT NOT NULL DEFAULT 'idle',
		  active_since TEXT,
		  ended_at TEXT,
		  last_remote_message_at TEXT,
		  PRIMARY KEY (integration, external_key),
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
		);
		CREATE TABLE chat_tool_result_cache (
		  cache_key TEXT PRIMARY KEY,
		  tool_name TEXT NOT NULL,
		  args_json TEXT NOT NULL,
		  value_json TEXT NOT NULL,
		  expires_at INTEGER NOT NULL,
		  created_at TEXT NOT NULL
		);
		CREATE TABLE projects (
		  id TEXT PRIMARY KEY,
		  slug TEXT NOT NULL UNIQUE,
		  name TEXT NOT NULL,
		  summary TEXT NOT NULL DEFAULT '',
		  folder_path TEXT NOT NULL,
		  persona_name TEXT,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL
		);
		CREATE INDEX idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
		CREATE INDEX idx_chat_sessions_project_id ON chat_sessions(project_id);
		CREATE INDEX idx_schedules_project_id ON schedules(project_id);
		CREATE INDEX idx_schedule_runs_schedule_id ON schedule_runs(schedule_id);
		CREATE INDEX idx_schedule_runs_started_at ON schedule_runs(started_at DESC);
	`);

	const projectWeekly = uid();
	const projectLaunch = uid();
	const weeklyPath = path.join(dest, "projects", projectWeekly);
	const launchPath = path.join(dest, "projects", projectLaunch);

	const insertProject = db.prepare(
		`INSERT INTO projects
		 (id, slug, name, summary, folder_path, persona_name, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const insertSession = db.prepare(
		`INSERT INTO chat_sessions
		 (id, name, created_at, updated_at, project_id)
		 VALUES (?, ?, ?, ?, ?)`,
	);
	const insertMessage = db.prepare(
		"INSERT INTO chat_session_messages (session_id, idx, role, content_json) VALUES (?,?,?,?)",
	);
	const insertTranscript = db.prepare(
		"INSERT INTO chat_session_transcript (session_id, idx, kind, text) VALUES (?,?,?,?)",
	);
	const insertSchedule = db.prepare(
		`INSERT INTO schedules
		 (id, name, prompt, persona_name, cron_expression, enabled,
		  last_run_at, created_at, updated_at, project_id)
		 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
	);
	const insertRun = db.prepare(
		`INSERT INTO schedule_runs
		 (id, schedule_id, persona_name, prompt, output, transcript, status,
		  error, started_at, completed_at)
		 VALUES (?, ?, 'Audrey', ?, ?, ?, 'success', NULL, ?, ?)`,
	);

	const projects: Array<[string, string, string, string, string, string]> = [
		[
			projectWeekly,
			"weekly-planning",
			"Weekly Planning",
			"Track goals, agendas, and status updates for the week.",
			weeklyPath,
			"Planner",
		],
		[
			projectLaunch,
			"product-launch",
			"Product Launch",
			"Launch checklist, messaging, and rollout notes for the new release.",
			launchPath,
			"Toby",
		],
	];

	function addSession(
		name: string,
		daysAgo: number,
		projectId: string | null,
		turns: Array<[string, string]>,
	): string {
		const sid = uid();
		const created = iso(addDays(NOW, -daysAgo));
		const updated = iso(addMinutes(addDays(NOW, -daysAgo), 5));
		insertSession.run(sid, name, created, updated, projectId);
		let idx = 0;
		const sysMsg =
			"You are Toby, a personal assistant with access to connected integrations " +
			"and global tools. Be helpful and concise.";
		insertMessage.run(sid, idx, "system", JSON.stringify(sysMsg));
		idx += 1;
		let tIdx = 0;
		for (const [role, text] of turns) {
			const content =
				role === "user"
					? JSON.stringify(
							`User request (verbatim):\n"${text}"\n\nRespond helpfully.`,
						)
					: JSON.stringify([{ type: "text", text }]);
			insertMessage.run(sid, idx, role, content);
			insertTranscript.run(sid, tIdx, role, text);
			idx += 1;
			tIdx += 1;
		}
		return sid;
	}

	const tx = db.transaction(() => {
		for (const [pid, slug, name, summary, folder, persona] of projects) {
			const created = iso(addDays(NOW, -14));
			insertProject.run(
				pid,
				slug,
				name,
				summary,
				folder,
				persona,
				created,
				iso(NOW),
			);
		}

		addSession("New chat", 0.1, null, []);
		addSession("Morning briefing", 0.5, null, [
			["user", "How are you today? Give me a short morning check-in."],
			[
				"assistant",
				"Good morning! I'm ready to help. Here's a quick check-in:\n\n" +
					"- **Calendar:** 2 meetings after 11 AM, open morning for focus work\n" +
					"- **Tasks:** 3 open items due this week\n" +
					"- **Inbox:** A few unread messages worth a skim\n\n" +
					"Want me to expand any of those?",
			],
		]);
		addSession("Weather check", 1, null, [
			["user", "What's the weather looking like this afternoon?"],
			[
				"assistant",
				"This afternoon looks **partly cloudy**, around **74°F**, with a light breeze. " +
					"A good day for a walk between meetings. I can set a reminder if the forecast changes.",
			],
		]);
		addSession("Unread email summary", 2, null, [
			["user", "Summarize my unread email that needs a reply."],
			[
				"assistant",
				"Here's a concise triage of unread mail that needs attention:\n\n" +
					"1. **Acme Design review** — feedback requested by Friday\n" +
					"2. **Vendor quote follow-up** — waiting on your approval\n" +
					"3. **Team offsite poll** — pick dates this week\n\n" +
					"Everything else looks low priority or automated.",
			],
		]);
		addSession("Art history question", 3, null, [
			[
				"user",
				"Can you remember that I prefer bullet summaries for art write-ups?",
			],
			[
				"assistant",
				"Got it — I'll use bullet summaries for art write-ups going forward. " +
					"I've saved that as a preference.",
			],
		]);
		addSession("Launch checklist chat", 1.5, projectLaunch, [
			["user", "What should we still finish for the product launch?"],
			[
				"assistant",
				"Launch remaining items:\n\n" +
					"- Finalize store screenshots\n" +
					"- Confirm support macros for day-one issues\n" +
					"- Schedule the customer email for release day\n" +
					"- Double-check feature flags in staging\n\n" +
					"I can draft the customer email next if you want.",
			],
		]);
		addSession("Weekly goals", 4, projectWeekly, [
			["user", "Draft my weekly goals overview."],
			[
				"assistant",
				"## This week's focus\n\n" +
					"- Ship the onboarding polish PR\n" +
					"- Prep design review for navigation\n" +
					"- Clear backlog triage on Wednesday\n\n" +
					"I'll keep this project folder updated as you check things off.",
			],
		]);

		const schedId = uid();
		insertSchedule.run(
			schedId,
			"Morning Inbox Check",
			"Scan the inbox for unread messages from the last 24 hours. " +
				"Summarize anything that needs a reply today in three urgency buckets.",
			"Audrey",
			"0 9 * * *",
			iso(addDays(NOW, -1)),
			iso(addDays(NOW, -20)),
			iso(addDays(NOW, -1)),
			null,
		);
		insertSchedule.run(
			uid(),
			"Friday weekly recap",
			"Draft a short weekly recap of completed tasks and open loops for Monday.",
			"Planner",
			"0 16 * * 5",
			null,
			iso(addDays(NOW, -12)),
			iso(addDays(NOW, -12)),
			projectWeekly,
		);

		const genericRunOutput =
			"## Morning inbox summary\n\n" +
			"### Immediate need\n" +
			"- Design review feedback requested for the checkout flow\n\n" +
			"### Short-term planning\n" +
			"- Vendor renewal discussion next week\n\n" +
			"### You can ignore\n" +
			"- Newsletter digests and automated receipts\n";

		for (let day = 1; day <= 5; day++) {
			const started = addHours(addDays(NOW, -day), -6);
			insertRun.run(
				uid(),
				schedId,
				"Scan the inbox for unread messages from the last 24 hours.",
				genericRunOutput,
				"Ran inbox scan and produced a 3-bucket summary.",
				iso(started),
				iso(addMs(started, 12_000)),
			);
		}
	});
	tx();
	db.close();
	chmodSafe(dbPath, 0o600);

	return {
		weekly: projectWeekly,
		launch: projectLaunch,
		weekly_path: weeklyPath,
		launch_path: launchPath,
	};
}

// ─── projects / skills / recordings / misc ──────────────────────────────────

function seedProjects(dest: string, projectIds: ProjectIds): void {
	const projectsRoot = path.join(dest, "projects");
	const specs: Array<[keyof ProjectIds, string]> = [
		[
			"weekly",
			"# Project Instructions\n\n" +
				"Focus on weekly goals, agenda prep, and short status updates.\n" +
				"Prefer calendars and task lists as sources of truth.\n",
		],
		[
			"launch",
			"# Project Instructions\n\n" +
				"Track launch readiness: messaging, checklists, and rollout notes.\n" +
				"Keep customer-facing copy clear and concise.\n",
		],
	];

	for (const [key, agents] of specs) {
		const pid = projectIds[key];
		const folder = path.join(projectsRoot, pid);
		fs.mkdirSync(folder, { recursive: true });
		writeText(path.join(folder, "AGENTS.md"), agents);
		const outputs = path.join(folder, "outputs");
		fs.mkdirSync(outputs, { recursive: true });
		if (key === "launch") {
			writeText(
				path.join(outputs, "launch-checklist.md"),
				"# Launch checklist\n\n" +
					"- [x] Feature freeze\n" +
					"- [ ] Store screenshots\n" +
					"- [ ] Support macros\n" +
					"- [ ] Release email\n",
			);
		}
		if (key === "weekly") {
			writeText(
				path.join(outputs, "week-overview.md"),
				"# Week overview\n\n" +
					"- Ship onboarding polish\n" +
					"- Design review prep\n" +
					"- Backlog triage\n",
			);
		}
	}
}

function seedSkills(dest: string): void {
	const skills = path.join(dest, "skills");
	const samples: Record<string, string> = {
		"organize-unread-emails": `---
name: organize-unread-emails
description: Organize unread email into urgency categories with suggested actions.
---

# Organize unread emails

1. Sync the mailbox and list unread messages from the last 7 days.
2. Group into **Immediate need**, **Short-term planning**, and **You can ignore**.
3. Suggest one clear next action per message.
4. Ask before sending replies or archiving.
`,
		"todays-agenda": `---
name: Todays Agenda
description: Brief overview of today's calendar and high-priority tasks.
---

# Today's agenda

1. Load today's calendar; skip low-value blocks like generic focus placeholders.
2. Highlight conflicts and suggest which meeting to prioritize.
3. List top open tasks due today.
4. Output sections: **High priority**, **Conflicts**, **Other**.
`,
		"weekly-update": `---
name: Weekly Update
description: Draft a weekly status update from tasks and calendar activity.
---

# Weekly update

Produce a short status document with:

## Overview
One paragraph on themes for the week.

## Completed
Bullet list of finished work.

## Next week
Top 3 priorities.
`,
		"my-open-tickets": `---
name: My Open Tickets
description: List open work-tracker tickets assigned to the current user.
---

# My open tickets

Search the work tracker for unresolved issues assigned to the current user.
Sort by priority and updated time. Summarize each with key, title, status, and next step.
`,
	};
	for (const [folder, body] of Object.entries(samples)) {
		const d = path.join(skills, folder);
		fs.mkdirSync(d, { recursive: true });
		writeText(path.join(d, "SKILL.md"), body);
	}
}

/**
 * Real dual-source recordings ship as `scripts/fixtures/listen-recordings.zip`
 * (combined + mic/system + transcripts). Seed unzips into the demo home so
 * playback, source switching, and timed transcripts work without bloating the
 * working tree with loose multi‑MB WAV files.
 */
function listenRecordingFixturesZip(): string {
	return path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"fixtures",
		"listen-recordings.zip",
	);
}

function extractZip(zipPath: string, destDir: string): void {
	fs.mkdirSync(destDir, { recursive: true });
	const result = spawnSync("unzip", ["-oq", zipPath, "-d", destDir], {
		encoding: "utf-8",
	});
	if (result.error) {
		throw new Error(
			`Failed to run unzip for ${zipPath}: ${result.error.message}`,
		);
	}
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout || "").trim();
		throw new Error(
			`unzip exited ${result.status} for ${zipPath}${detail ? `: ${detail}` : ""}`,
		);
	}
}

/** Normalize metadata.files to portable relative basenames after extract/copy. */
function normalizeRecordingMetadata(destDir: string, id: string): void {
	const metaPath = path.join(destDir, "metadata.json");
	if (!fs.existsSync(metaPath)) {
		throw new Error(`Recording fixture ${id} is missing metadata.json`);
	}
	const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
		id?: string;
		files?: Record<string, unknown>;
		[key: string]: unknown;
	};
	const files = {
		...(typeof meta.files === "object" && meta.files ? meta.files : {}),
	} as Record<string, string>;
	for (const key of [
		"combined",
		"mic",
		"system",
		"transcript",
		"transcriptJson",
		"summary",
	] as const) {
		const val = files[key];
		if (typeof val === "string" && val.trim()) {
			files[key] = path.basename(val);
		}
	}
	const defaults: Record<string, string> = {
		combined: "combined.m4a",
		mic: "mic.wav",
		system: "system.wav",
		transcript: "transcript.txt",
		transcriptJson: "transcript.json",
		summary: "summary.md",
	};
	for (const [key, basename] of Object.entries(defaults)) {
		if (fs.existsSync(path.join(destDir, basename))) {
			files[key] = basename;
		}
	}
	meta.id = typeof meta.id === "string" && meta.id ? meta.id : id;
	meta.files = files;
	writeJson(metaPath, meta);

	const hasAudio =
		fs.existsSync(path.join(destDir, "combined.m4a")) ||
		fs.existsSync(path.join(destDir, "mic.wav")) ||
		fs.existsSync(path.join(destDir, "system.wav"));
	const hasTranscript =
		fs.existsSync(path.join(destDir, "transcript.txt")) ||
		fs.existsSync(path.join(destDir, "transcript.json"));
	if (!hasAudio || !hasTranscript) {
		throw new Error(
			`Recording fixture ${id} is incomplete (audio=${hasAudio}, transcript=${hasTranscript}).`,
		);
	}
}

function seedRecordings(dest: string): void {
	const root = path.join(dest, "listen", "recordings");
	const zipPath = listenRecordingFixturesZip();
	if (!fs.existsSync(zipPath)) {
		throw new Error(
			`Recording fixtures zip missing at ${zipPath}. Expected scripts/fixtures/listen-recordings.zip.`,
		);
	}

	extractZip(zipPath, root);

	const fixtureIds = fs
		.readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && !e.name.startsWith("."))
		.map((e) => e.name)
		.sort();

	if (fixtureIds.length === 0) {
		throw new Error(
			`No recording directories found after extracting ${zipPath}.`,
		);
	}

	for (const id of fixtureIds) {
		normalizeRecordingMetadata(path.join(root, id), id);
	}
}

function seedMisc(dest: string): void {
	for (const rel of [
		"logs",
		"persona/images",
		"plugins-data",
		"generated-files",
		"staging",
		"listen/tmp",
	]) {
		fs.mkdirSync(path.join(dest, rel), { recursive: true });
	}
	writeJson(path.join(dest, "dashboard-summaries.json"), {
		generatedAt: iso(NOW),
		sections: {
			mail: "A few messages need replies; nothing urgent after triage.",
			tasks: "Three open tasks due this week; one blocked on design review.",
			calendar: "Open morning; two meetings after 11 AM.",
		},
	});
	fs.writeFileSync(path.join(dest, "toby.db"), Buffer.alloc(0));

	writeText(
		path.join(dest, "README.md"),
		`# Toby generic home (docs / screenshots)

This directory is a **non-personal** Toby data home for documentation screenshots.
It was generated by \`scripts/seed-toby-generic-home.ts\` and does **not** replace \`~/.toby\`.

## Use it

\`\`\`bash
# Preferred: seed if needed, build Dev, launch with this home
bun run app:screenshots

# Or manually:
export TOBY_DIR="${dest}"
export TOBY_CREDENTIALS_KEY_BACKEND=plaintext
bun run --filter @toby/cli start -- status
TOBY_DIR="${dest}" TOBY_CREDENTIALS_KEY_BACKEND=plaintext bun run app
\`\`\`

## Contents

- Generic **memories**, **chats**, **projects**, **schedules**, **skills**
- **Recordings** extracted from \`scripts/fixtures/listen-recordings.zip\` (real dual-source audio + transcripts)
- Placeholder **credentials** (not real secrets)
- Integration **connection flags** copied from your real config so Integrations look connected

## Re-seed

\`\`\`bash
bun run app:screenshots -- --reseed
# or:
bun scripts/seed-toby-generic-home.ts "${dest}"
\`\`\`

Re-seeding **wipes** the destination and rebuilds it.
`,
	);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

type Args = {
	destPositional: string | null;
	destFlag: string | null;
	source: string | null;
	noSource: boolean;
	allowDefaultHome: boolean;
	help: boolean;
};

function printUsage(): void {
	console.log(`Usage: bun scripts/seed-toby-generic-home.ts [FOLDER] [options]

Populate a folder with a generic Toby home (sample data).

Arguments:
  FOLDER                 Folder to populate as a Toby data home (created if
                         missing; wiped if it already exists).
                         Default: ~/.toby-generic

Options:
  --dest <path>          Same as FOLDER (for scripts)
  --source <path>        Existing Toby home to copy integration connection
                         flags from (never modified). Default: ~/.toby
  --no-source            Do not read any existing home; use built-in samples
  --allow-default-home   Allow writing to the real default home ~/.toby
                         (dangerous; wipes it)
  -h, --help             Show this help

Examples:
  bun scripts/seed-toby-generic-home.ts ~/Desktop/toby-demo
  bun scripts/seed-toby-generic-home.ts /tmp/toby-sample --no-source
  bun run seed:home -- ~/Desktop/toby-demo
`);
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		destPositional: null,
		destFlag: null,
		source: null,
		noSource: false,
		allowDefaultHome: false,
		help: false,
	};
	const rest = [...argv];
	while (rest.length > 0) {
		const a = rest.shift();
		if (a === undefined) break;
		if (a === "-h" || a === "--help") {
			args.help = true;
		} else if (a === "--no-source") {
			args.noSource = true;
		} else if (a === "--allow-default-home") {
			args.allowDefaultHome = true;
		} else if (a === "--force") {
			// no-op: wipe is always on (kept for CLI compatibility)
		} else if (a === "--dest") {
			const v = rest.shift();
			if (!v) throw new Error("--dest requires a path");
			args.destFlag = v;
		} else if (a.startsWith("--dest=")) {
			args.destFlag = a.slice("--dest=".length);
		} else if (a === "--source") {
			const v = rest.shift();
			if (!v) throw new Error("--source requires a path");
			args.source = v;
		} else if (a.startsWith("--source=")) {
			args.source = a.slice("--source=".length);
		} else if (a.startsWith("-")) {
			throw new Error(`Unknown option: ${a}`);
		} else if (args.destPositional == null) {
			args.destPositional = a;
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}
	return args;
}

function resolveDest(positional: string | null, flag: string | null): string {
	if (positional != null && flag != null) {
		const pos = resolvePath(positional);
		const fl = resolvePath(flag);
		if (pos !== fl) {
			throw new Error(
				`Conflicting destinations: positional ${pos} vs --dest ${fl}`,
			);
		}
		return pos;
	}
	const chosen = positional ?? flag;
	if (chosen == null) {
		return resolvePath(path.join(os.homedir(), ".toby-generic"));
	}
	return resolvePath(chosen);
}

function main(): void {
	let args: Args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		printUsage();
		process.exit(1);
	}

	if (args.help) {
		printUsage();
		process.exit(0);
	}

	const defaultRealHome = resolvePath(path.join(os.homedir(), ".toby"));
	let dest: string;
	try {
		dest = resolveDest(args.destPositional, args.destFlag);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	if (dest === defaultRealHome && !args.allowDefaultHome) {
		console.error(
			`Refusing to seed the real default home (${defaultRealHome}).\nPick another folder, or pass --allow-default-home if you truly mean to wipe it.`,
		);
		process.exit(1);
	}

	let useSource = !args.noSource;
	const source = resolvePath(args.source ?? path.join(os.homedir(), ".toby"));

	if (useSource && source === dest) {
		console.error("Source and dest must differ — refusing to overwrite.");
		process.exit(1);
	}

	if (useSource && !fs.existsSync(source)) {
		console.warn(
			`Warning: source ${source} missing; seeding with built-in defaults only.`,
		);
		useSource = false;
	}

	console.log(`Seeding generic Toby home\n  dest:   ${dest}`);
	if (useSource) {
		console.log(`  source: ${source} (flags only; not modified)`);
	} else {
		console.log("  source: (none — built-in sample integrations)");
	}
	if (fs.existsSync(dest)) {
		console.log(`  note:   wiping existing contents of ${dest}`);
	}

	ensureCleanDest(dest);

	const configSource = useSource ? source : path.join(dest, ".no-such-source");
	copyConfig(configSource, dest);
	writeCredentials(dest);
	seedMemoryDb(dest);
	const projectIds = seedChatDb(dest);
	seedProjects(dest, projectIds);
	seedSkills(dest);
	seedRecordings(dest);
	seedMisc(dest);

	chmodSafe(dest, 0o700);

	console.log("Done.");
	console.log(`  memories: ${path.join(dest, "memory.sqlite")}`);
	console.log(`  chat db:  ${path.join(dest, "chat.sqlite")}`);
	console.log(`  readme:   ${path.join(dest, "README.md")}`);
	console.log();
	console.log("Use this home:");
	console.log(
		`  TOBY_DIR="${dest}" TOBY_CREDENTIALS_KEY_BACKEND=plaintext bun run app`,
	);
	console.log(
		"  # or Settings → General → Home directory → Choose… this folder",
	);
	console.log(
		"  # or: bun run app:screenshots  (uses ~/.toby-generic by default)",
	);
}

main();
