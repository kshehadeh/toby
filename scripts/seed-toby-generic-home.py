#!/usr/bin/env python3
"""
Seed a non-personal Toby home directory for docs screenshots.

Copies structure from an existing Toby home (default: ~/.toby), then replaces
user-specific content with generic sample data. Never overwrites the source.

Usage:
  python3 scripts/seed-toby-generic-home.py
  python3 scripts/seed-toby-generic-home.py --source ~/.toby --dest ~/.toby-generic

Launch the app against it:
  bun run app:screenshots
  # or manually:
  TOBY_DIR="$HOME/.toby-generic" TOBY_CREDENTIALS_KEY_BACKEND=plaintext bun run app
  # or for a running binary / Dev app that inherits env:
  open -n --env TOBY_DIR="$HOME/.toby-generic" --env TOBY_CREDENTIALS_KEY_BACKEND=plaintext "dist/Toby (Dev).app"
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import stat
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

NOW = datetime(2026, 7, 10, 15, 30, 0, tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def uid() -> str:
    return str(uuid.uuid4())


def ensure_clean_dest(dest: Path, force: bool) -> None:
    if dest.exists():
        if not force:
            # Allow re-seed: wipe dest entirely so we never merge with stale personal data
            shutil.rmtree(dest)
        else:
            shutil.rmtree(dest)
    dest.mkdir(parents=True, mode=0o700)


def write_json(path: Path, data: object, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    path.chmod(mode)


def copy_config(source: Path, dest: Path) -> None:
    """Keep integration connection flags and provider structure; generic personas."""
    src_cfg_path = source / "config.json"
    base: dict = {}
    if src_cfg_path.exists():
        try:
            base = json.loads(src_cfg_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            base = {}

    integrations = base.get("integrations") or {}
    # Preserve connected plugins so Settings / Integrations screens look populated
    connected = {}
    for name, meta in integrations.items():
        if isinstance(meta, dict):
            connected[name] = {
                k: v
                for k, v in meta.items()
                if k in ("connectedAt", "pluginVersion", "inboundEnabled")
            }

    config = {
        "integrations": connected
        or {
            "email": {"connectedAt": iso(NOW - timedelta(days=5)), "pluginVersion": "1.0.0"},
            "applecalendar": {
                "connectedAt": iso(NOW - timedelta(days=4)),
                "pluginVersion": "1.1.0",
            },
            "todoist": {"connectedAt": iso(NOW - timedelta(days=3)), "pluginVersion": "1.0.0"},
            "slack": {
                "connectedAt": iso(NOW - timedelta(days=2)),
                "pluginVersion": "1.0.0",
                "inboundEnabled": True,
            },
            "macos": {"connectedAt": iso(NOW - timedelta(days=10)), "pluginVersion": "1.1.0"},
        },
        "personas": [
            {
                "name": "Toby",
                "instructions": (
                    "You are Toby, a friendly personal assistant. Be concise, practical, "
                    "and proactive about next steps. Prefer clear bullet lists for multi-step work."
                ),
                "promptMode": "add",
                "ai": {"provider": "openai", "model": "gpt-5-mini"},
            },
            {
                "name": "Audrey",
                "instructions": (
                    "You help triage email and tasks into urgency categories: "
                    "Immediate Need, Short-term Planning, and You Can Ignore. "
                    "Be decisive and structured."
                ),
                "promptMode": "add",
                "ai": {"provider": "openai", "model": "gpt-5-mini"},
            },
            {
                "name": "Planner",
                "instructions": (
                    "You help with calendars, agendas, and weekly planning. "
                    "Call out conflicts and suggest preparation for important meetings."
                ),
                "promptMode": "add",
                "ai": {"provider": "openai", "model": "gpt-5-mini"},
            },
        ],
        "defaultPersona": "Toby",
        "defaultProviders": base.get("defaultProviders")
        or {
            "email": "email",
            "calendar": "applecalendar",
            "tasks": "todoist",
            "contacts": "applecontacts",
            "chat": "slack",
            "documents": "notion",
            "work_tracker": "jira",
        },
        "chatInbound": {
            "enabled": True,
            "integration": "slack",
            "persona": "Planner",
        },
        "transcription": base.get("transcription")
        or {"provider": "openai", "model": "gpt-4o-transcribe"},
        "webSearch": base.get("webSearch") or {"provider": "ai-gateway", "enabled": True},
        "weather": base.get("weather") or {"enabled": True, "temperatureUnit": "fahrenheit"},
        "dashboard": {"persona": "Toby"},
    }
    write_json(dest / "config.json", config, 0o600)


def write_credentials(dest: Path) -> None:
    """Plaintext placeholders only — not real secrets. App may re-encrypt on first write."""
    creds = {
        "integrations": {
            "email": {
                "fromAddress": "alex@example.com",
                "fromName": "Alex Rivera",
                "imapHost": "imap.example.com",
                "imapPort": "993",
                "imapUser": "alex@example.com",
                "imapPassword": "demo-password-not-real",
                "imapTls": "true",
                "smtpHost": "smtp.example.com",
                "smtpPort": "587",
                "smtpUser": "alex@example.com",
                "smtpPassword": "demo-password-not-real",
            },
            "todoist": {"apiToken": "demo-todoist-token"},
            "slack": {
                "botToken": "xoxb-demo-not-real",
                "appToken": "xapp-demo-not-real",
            },
            "jira": {
                "baseUrl": "https://example.atlassian.net",
                "email": "alex@example.com",
                "apiToken": "demo-jira-token",
            },
            "notion": {"apiKey": "secret_demo_notion"},
        },
        "ai": {
            "openai": {"apiKey": "sk-demo-openai-not-real"},
            "vercel": {"apiKey": "vck_demo_vercel_not_real"},
        },
        "transcription": {"openai": {"apiKey": "sk-demo-transcription-not-real"}},
    }
    write_json(dest / "credentials.json", creds, 0o600)


def seed_memory_db(dest: Path) -> None:
    path = dest / "memory.sqlite"
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    conn.executescript(
        """
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
        """
    )

    memories = [
        ("fact", "identity", "User's name is Alex Rivera.", 1.0),
        (
            "preference",
            "Work style",
            "Prefers bullet-point summaries and morning briefings before 9 AM.",
            0.95,
        ),
        (
            "fact",
            "employment",
            "Works as a product designer at Northstar Labs, focused on mobile apps.",
            1.0,
        ),
        (
            "preference",
            "Meetings",
            "Prefers no meetings before 10 AM and keeps Fridays free for deep work.",
            0.9,
        ),
        (
            "fact",
            "timezone",
            "Usually works in America/New_York timezone.",
            0.85,
        ),
    ]

    for i, (typ, subject, value, conf) in enumerate(memories):
        mid = uid()
        sid = uid()
        created = iso(NOW - timedelta(days=10 - i))
        conn.execute(
            """INSERT INTO memory_sources
               (id, user_id, system, source_id, source_url, observed_at, excerpt, metadata_json)
               VALUES (?, 'default', 'manual', NULL, NULL, ?, NULL, NULL)""",
            (sid, created),
        )
        conn.execute(
            """INSERT INTO memory_items
               (id, user_id, type, subject, value, confidence, sensitivity, visibility,
                expires_at, created_at, updated_at)
               VALUES (?, 'default', ?, ?, ?, ?, 'normal', 'usable_by_ai', NULL, ?, ?)""",
            (mid, typ, subject, value, conf, created, created),
        )
        conn.execute(
            "INSERT INTO memory_item_sources (memory_id, source_id) VALUES (?, ?)",
            (mid, sid),
        )
        conn.execute(
            """INSERT INTO memory_audit_log
               (id, user_id, memory_id, action, detail_json, created_at)
               VALUES (?, 'default', ?, 'created', NULL, ?)""",
            (uid(), mid, created),
        )

    conn.commit()
    conn.close()
    path.chmod(0o600)


def seed_chat_db(dest: Path) -> dict[str, str]:
    """Return project id map for folder seeding."""
    path = dest / "chat.sqlite"
    if path.exists():
        path.unlink()

    # Copy schema from a minimal recreate (no personal rows)
    conn = sqlite3.connect(path)
    conn.executescript(
        """
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
        """
    )

    project_weekly = uid()
    project_launch = uid()
    weekly_path = str(dest / "projects" / project_weekly)
    launch_path = str(dest / "projects" / project_launch)

    projects = [
        (
            project_weekly,
            "weekly-planning",
            "Weekly Planning",
            "Track goals, agendas, and status updates for the week.",
            weekly_path,
            "Planner",
        ),
        (
            project_launch,
            "product-launch",
            "Product Launch",
            "Launch checklist, messaging, and rollout notes for the new release.",
            launch_path,
            "Toby",
        ),
    ]
    for pid, slug, name, summary, folder, persona in projects:
        created = iso(NOW - timedelta(days=14))
        conn.execute(
            """INSERT INTO projects
               (id, slug, name, summary, folder_path, persona_name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (pid, slug, name, summary, folder, persona, created, iso(NOW)),
        )

    def add_session(
        name: str,
        days_ago: float,
        project_id: str | None,
        turns: list[tuple[str, str]],
    ) -> str:
        sid = uid()
        created = iso(NOW - timedelta(days=days_ago))
        updated = iso(NOW - timedelta(days=days_ago) + timedelta(minutes=5))
        conn.execute(
            """INSERT INTO chat_sessions
               (id, name, created_at, updated_at, project_id)
               VALUES (?, ?, ?, ?, ?)""",
            (sid, name, created, updated, project_id),
        )
        # Minimal system + user/assistant messages
        idx = 0
        sys_msg = (
            "You are Toby, a personal assistant with access to connected integrations "
            "and global tools. Be helpful and concise."
        )
        conn.execute(
            "INSERT INTO chat_session_messages (session_id, idx, role, content_json) VALUES (?,?,?,?)",
            (sid, idx, "system", json.dumps(sys_msg)),
        )
        idx += 1
        t_idx = 0
        for role, text in turns:
            if role == "user":
                content = json.dumps(
                    f'User request (verbatim):\n"{text}"\n\nRespond helpfully.'
                )
            else:
                content = json.dumps(
                    [{"type": "text", "text": text}],
                    ensure_ascii=False,
                )
            conn.execute(
                "INSERT INTO chat_session_messages (session_id, idx, role, content_json) VALUES (?,?,?,?)",
                (sid, idx, role, content),
            )
            conn.execute(
                "INSERT INTO chat_session_transcript (session_id, idx, kind, text) VALUES (?,?,?,?)",
                (sid, t_idx, role, text),
            )
            idx += 1
            t_idx += 1
        return sid

    add_session(
        "New chat",
        0.1,
        None,
        [],
    )
    add_session(
        "Morning briefing",
        0.5,
        None,
        [
            (
                "user",
                "How are you today? Give me a short morning check-in.",
            ),
            (
                "assistant",
                "Good morning! I'm ready to help. Here's a quick check-in:\n\n"
                "- **Calendar:** 2 meetings after 11 AM, open morning for focus work\n"
                "- **Tasks:** 3 open items due this week\n"
                "- **Inbox:** A few unread messages worth a skim\n\n"
                "Want me to expand any of those?",
            ),
        ],
    )
    add_session(
        "Weather check",
        1,
        None,
        [
            ("user", "What's the weather looking like this afternoon?"),
            (
                "assistant",
                "This afternoon looks **partly cloudy**, around **74°F**, with a light breeze. "
                "A good day for a walk between meetings. I can set a reminder if the forecast changes.",
            ),
        ],
    )
    add_session(
        "Unread email summary",
        2,
        None,
        [
            ("user", "Summarize my unread email that needs a reply."),
            (
                "assistant",
                "Here's a concise triage of unread mail that needs attention:\n\n"
                "1. **Acme Design review** — feedback requested by Friday\n"
                "2. **Vendor quote follow-up** — waiting on your approval\n"
                "3. **Team offsite poll** — pick dates this week\n\n"
                "Everything else looks low priority or automated.",
            ),
        ],
    )
    add_session(
        "Art history question",
        3,
        None,
        [
            ("user", "Can you remember that I prefer bullet summaries for art write-ups?"),
            (
                "assistant",
                "Got it — I'll use bullet summaries for art write-ups going forward. "
                "I've saved that as a preference.",
            ),
        ],
    )
    add_session(
        "Launch checklist chat",
        1.5,
        project_launch,
        [
            ("user", "What should we still finish for the product launch?"),
            (
                "assistant",
                "Launch remaining items:\n\n"
                "- Finalize store screenshots\n"
                "- Confirm support macros for day-one issues\n"
                "- Schedule the customer email for release day\n"
                "- Double-check feature flags in staging\n\n"
                "I can draft the customer email next if you want.",
            ),
        ],
    )
    add_session(
        "Weekly goals",
        4,
        project_weekly,
        [
            ("user", "Draft my weekly goals overview."),
            (
                "assistant",
                "## This week's focus\n\n"
                "- Ship the onboarding polish PR\n"
                "- Prep design review for navigation\n"
                "- Clear backlog triage on Wednesday\n\n"
                "I'll keep this project folder updated as you check things off.",
            ),
        ],
    )

    # Schedules
    sched_id = uid()
    conn.execute(
        """INSERT INTO schedules
           (id, name, prompt, persona_name, cron_expression, enabled,
            last_run_at, created_at, updated_at, project_id)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)""",
        (
            sched_id,
            "Morning Inbox Check",
            (
                "Scan the inbox for unread messages from the last 24 hours. "
                "Summarize anything that needs a reply today in three urgency buckets."
            ),
            "Audrey",
            "0 9 * * *",
            iso(NOW - timedelta(days=1)),
            iso(NOW - timedelta(days=20)),
            iso(NOW - timedelta(days=1)),
        ),
    )
    conn.execute(
        """INSERT INTO schedules
           (id, name, prompt, persona_name, cron_expression, enabled,
            last_run_at, created_at, updated_at, project_id)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)""",
        (
            uid(),
            "Friday weekly recap",
            "Draft a short weekly recap of completed tasks and open loops for Monday.",
            "Planner",
            "0 16 * * 5",
            None,
            iso(NOW - timedelta(days=12)),
            iso(NOW - timedelta(days=12)),
            project_weekly,
        ),
    )

    generic_run_output = (
        "## Morning inbox summary\n\n"
        "### Immediate need\n"
        "- Design review feedback requested for the checkout flow\n\n"
        "### Short-term planning\n"
        "- Vendor renewal discussion next week\n\n"
        "### You can ignore\n"
        "- Newsletter digests and automated receipts\n"
    )
    for day in range(1, 6):
        started = NOW - timedelta(days=day, hours=6)
        conn.execute(
            """INSERT INTO schedule_runs
               (id, schedule_id, persona_name, prompt, output, transcript, status,
                error, started_at, completed_at)
               VALUES (?, ?, 'Audrey', ?, ?, ?, 'success', NULL, ?, ?)""",
            (
                uid(),
                sched_id,
                "Scan the inbox for unread messages from the last 24 hours.",
                generic_run_output,
                "Ran inbox scan and produced a 3-bucket summary.",
                iso(started),
                iso(started + timedelta(seconds=12)),
            ),
        )

    conn.commit()
    conn.close()
    path.chmod(0o600)
    return {
        "weekly": project_weekly,
        "launch": project_launch,
        "weekly_path": weekly_path,
        "launch_path": launch_path,
    }


def seed_projects(dest: Path, project_ids: dict[str, str]) -> None:
    projects_root = dest / "projects"
    for key, label, agents in (
        (
            "weekly",
            "Weekly Planning",
            "# Project Instructions\n\n"
            "Focus on weekly goals, agenda prep, and short status updates.\n"
            "Prefer calendars and task lists as sources of truth.\n",
        ),
        (
            "launch",
            "Product Launch",
            "# Project Instructions\n\n"
            "Track launch readiness: messaging, checklists, and rollout notes.\n"
            "Keep customer-facing copy clear and concise.\n",
        ),
    ):
        pid = project_ids[key]
        folder = projects_root / pid
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "AGENTS.md").write_text(agents, encoding="utf-8")
        outputs = folder / "outputs"
        outputs.mkdir(exist_ok=True)
        if key == "launch":
            (outputs / "launch-checklist.md").write_text(
                "# Launch checklist\n\n"
                "- [x] Feature freeze\n"
                "- [ ] Store screenshots\n"
                "- [ ] Support macros\n"
                "- [ ] Release email\n",
                encoding="utf-8",
            )
        if key == "weekly":
            (outputs / "week-overview.md").write_text(
                "# Week overview\n\n"
                "- Ship onboarding polish\n"
                "- Design review prep\n"
                "- Backlog triage\n",
                encoding="utf-8",
            )


def seed_skills(dest: Path) -> None:
    skills = dest / "skills"
    samples = {
        "organize-unread-emails": """---
name: organize-unread-emails
description: Organize unread email into urgency categories with suggested actions.
---

# Organize unread emails

1. Sync the mailbox and list unread messages from the last 7 days.
2. Group into **Immediate need**, **Short-term planning**, and **You can ignore**.
3. Suggest one clear next action per message.
4. Ask before sending replies or archiving.
""",
        "todays-agenda": """---
name: Todays Agenda
description: Brief overview of today's calendar and high-priority tasks.
---

# Today's agenda

1. Load today's calendar; skip low-value blocks like generic focus placeholders.
2. Highlight conflicts and suggest which meeting to prioritize.
3. List top open tasks due today.
4. Output sections: **High priority**, **Conflicts**, **Other**.
""",
        "weekly-update": """---
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
""",
        "my-open-tickets": """---
name: My Open Tickets
description: List open work-tracker tickets assigned to the current user.
---

# My open tickets

Search the work tracker for unresolved issues assigned to the current user.
Sort by priority and updated time. Summarize each with key, title, status, and next step.
""",
    }
    for folder, body in samples.items():
        d = skills / folder
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(body, encoding="utf-8")


def seed_recordings(dest: Path) -> None:
    root = dest / "listen" / "recordings"
    samples = [
        {
            "id": "2026-07-06T15-00-00-000Z-DEMO01",
            "name": "Product Planning Sync",
            "duration_ms": 18 * 60 * 1000 + 40 * 1000,
            "summary": """# Product Planning Sync — Summary

A working session to refine the Q3 roadmap and align on launch criteria.

## Key decisions
- Target **feature freeze** two weeks before release
- Prioritize onboarding polish over experimental settings
- Keep release notes customer-facing and short

## Action items
- Alex: draft release email outline
- Sam: update QA checklist for mobile
- Jordan: schedule design review
""",
            "transcript": """Alex: Thanks everyone for joining. Let's walk the roadmap board.

Sam: Onboarding is the riskiest item for support volume if we ship incomplete.

Jordan: Agreed. I can have revised flows ready by Thursday for review.

Alex: Perfect. We'll freeze experimental settings and focus the release message on clarity.

Sam: I'll update the QA checklist to cover the new empty states.

Alex: Great. We'll reconvene Friday for a go / no-go check.
""",
        },
        {
            "id": "2026-07-02T14-00-00-000Z-DEMO02",
            "name": "Design Critique",
            "duration_ms": 32 * 60 * 1000,
            "summary": """# Design Critique — Summary

Reviewed navigation and empty-state mockups for the mobile app.

## Feedback themes
- Increase contrast on secondary actions
- Empty states should suggest one primary next step
- Keep iconography consistent with the system set

## Follow-ups
- Update empty-state copy
- Share a second pass mid-week
""",
            "transcript": """Jordan: Starting with the home empty state. The CTA is easy to miss.

Alex: Let's make the primary button full width on small screens.

Sam: And drop the second link into a text button so hierarchy is clearer.

Jordan: I'll revise and ping the group by Wednesday.
""",
        },
        {
            "id": "2026-07-01T16-30-00-000Z-DEMO03",
            "name": "Customer Discovery Call",
            "duration_ms": 25 * 60 * 1000 + 50 * 1000,
            "summary": """# Customer Discovery Call — Summary

Spoke with a mid-market customer about weekly planning pain points.

## Insights
- Manual status collection takes most of Monday morning
- They want templates more than free-form docs
- Integrations with calendar and tasks are table stakes

## Opportunities
- Opinionated weekly template
- One-click pull from tasks + calendar
""",
            "transcript": """Alex: What does planning look like for your team today?

Customer: Honestly, a lot of copy-paste from tickets into a slide deck.

Alex: If Toby drafted the first version automatically, what would you still edit?

Customer: Tone and priorities — but not the raw list of work items.
""",
        },
    ]

    for s in samples:
        d = root / s["id"]
        d.mkdir(parents=True, exist_ok=True)
        try:
            started = datetime.strptime(s["id"][:19], "%Y-%m-%dT%H-%M-%S").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            started = NOW - timedelta(days=5)
        stopped = started + timedelta(milliseconds=s["duration_ms"])
        meta = {
            "id": s["id"],
            "name": s["name"],
            "createdAt": iso(started),
            "startedAt": iso(started),
            "stoppedAt": iso(stopped),
            "durationMs": s["duration_ms"],
            "sources": {"mic": True, "system": True},
            "files": {
                "transcript": "transcript.txt",
                "transcriptJson": "transcript.json",
                "summary": "summary.md",
            },
            "platform": "darwin",
            "osVersion": "Version 15.0 (Build Demo)",
            "helper": {"path": "Toby.app", "version": "native-app"},
            "summary": {"createdAt": iso(stopped + timedelta(minutes=2)), "personaName": "Toby"},
        }
        # Paths relative-friendly; absolute for display in UI
        meta["files"]["combined"] = str(d / "combined.m4a")
        (d / "metadata.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        (d / "summary.md").write_text(s["summary"], encoding="utf-8")
        (d / "transcript.txt").write_text(s["transcript"], encoding="utf-8")
        (d / "transcript.json").write_text(
            json.dumps(
                {
                    "text": s["transcript"],
                    "segments": [
                        {"start": 0, "end": 5, "text": line}
                        for line in s["transcript"].strip().splitlines()
                        if line.strip()
                    ],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        # Tiny placeholder audio so "has audio" UIs don't break if they only check path existence
        (d / "combined.m4a").write_bytes(b"")


def seed_misc(dest: Path) -> None:
    (dest / "logs").mkdir(exist_ok=True)
    (dest / "persona" / "images").mkdir(parents=True, exist_ok=True)
    (dest / "plugins-data").mkdir(exist_ok=True)
    (dest / "generated-files").mkdir(exist_ok=True)
    (dest / "staging").mkdir(exist_ok=True)
    (dest / "listen" / "tmp").mkdir(parents=True, exist_ok=True)
    write_json(
        dest / "dashboard-summaries.json",
        {
            "generatedAt": iso(NOW),
            "sections": {
                "mail": "A few messages need replies; nothing urgent after triage.",
                "tasks": "Three open tasks due this week; one blocked on design review.",
                "calendar": "Open morning; two meetings after 11 AM.",
            },
        },
    )
    # empty toby.db placeholder like real home
    (dest / "toby.db").write_bytes(b"")

    readme = dest / "README.md"
    readme.write_text(
        f"""# Toby generic home (docs / screenshots)

This directory is a **non-personal** Toby data home for documentation screenshots.
It was generated by `scripts/seed-toby-generic-home.py` and does **not** replace `~/.toby`.

## Use it

```bash
# Preferred: seed if needed, build Dev, launch with this home
bun run app:screenshots

# Or manually:
export TOBY_DIR="{dest}"
export TOBY_CREDENTIALS_KEY_BACKEND=plaintext
bun run --filter @toby/cli start -- status
TOBY_DIR="{dest}" TOBY_CREDENTIALS_KEY_BACKEND=plaintext bun run app
```

## Contents

- Generic **memories**, **chats**, **projects**, **schedules**, **skills**, **recordings**
- Placeholder **credentials** (not real secrets)
- Integration **connection flags** copied from your real config so Integrations look connected

## Re-seed

```bash
bun run app:screenshots -- --reseed
# or:
python3 scripts/seed-toby-generic-home.py --dest "{dest}"
```

Re-seeding **wipes** the destination and rebuilds it.
""",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.home() / ".toby",
        help="Existing Toby home to copy structure/flags from (never modified)",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path.home() / ".toby-generic",
        help="Destination home directory (default: ~/.toby-generic)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Same as default: wipe dest if it exists before seeding",
    )
    args = parser.parse_args()
    source: Path = args.source.expanduser().resolve()
    dest: Path = args.dest.expanduser().resolve()

    if source == dest:
        raise SystemExit("Source and dest must differ — refusing to overwrite.")

    if not source.is_dir():
        print(f"Warning: source {source} missing; seeding with built-in defaults only.")

    print(f"Seeding generic Toby home\n  source: {source}\n  dest:   {dest}")
    ensure_clean_dest(dest, force=args.force)

    copy_config(source, dest)
    write_credentials(dest)
    seed_memory_db(dest)
    project_ids = seed_chat_db(dest)
    seed_projects(dest, project_ids)
    seed_skills(dest)
    seed_recordings(dest)
    seed_misc(dest)

    # Restrictive perms on home
    dest.chmod(0o700)

    print("Done.")
    print(f"  memories: {dest / 'memory.sqlite'}")
    print(f"  chat db:  {dest / 'chat.sqlite'}")
    print(f"  readme:   {dest / 'README.md'}")
    print()
    print("Launch with:")
    print("  bun run app:screenshots")
    print(f'  # or: TOBY_DIR="{dest}" TOBY_CREDENTIALS_KEY_BACKEND=plaintext bun run app')


if __name__ == "__main__":
    main()
