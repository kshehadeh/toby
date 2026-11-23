import GRDB

/// Swift-owned schema. Migration `v1` mirrors the legacy daemon tables so the
/// one-time import is a column-intersecting copy; later migrations evolve it.
///
/// Not carried over (features removed or rebuildable caches):
/// `user_tools`, `user_tool_revisions`, `routing_embeddings`,
/// `chat_tool_result_cache`, `chat_pretreatment_cache`.
enum Schema {
	static func migrator() -> DatabaseMigrator {
		var migrator = DatabaseMigrator()
		migrator.registerMigration("v1") { db in
			for statement in v1 {
				try db.execute(sql: statement)
			}
		}
		migrator.registerMigration("v2-mail") { db in
			for statement in v2Mail {
				try db.execute(sql: statement)
			}
		}
		migrator.registerMigration("v3-feed") { db in
			try db.execute(sql: "CREATE TABLE feed_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
			try db.execute(sql: "CREATE TABLE feed_decisions (item_id TEXT PRIMARY KEY, decision TEXT NOT NULL)")
			try db.execute(sql: "CREATE INDEX feed_pending_actions ON feed_decisions(item_id) WHERE json_extract(decision, '$.kind') = 'pending'")
			try db.execute(sql: "CREATE TABLE feed_members (identity TEXT PRIMARY KEY, card_id TEXT NOT NULL, activity TEXT)")
			try db.execute(sql: "CREATE INDEX feed_members_card ON feed_members(card_id)")
		}
		return migrator
	}

	/// Mail cache (mirrors the email plugin's `email.sqlite`, `mail_` prefixed).
	static let v2Mail = [
		"""
		CREATE TABLE IF NOT EXISTS mail_messages (
			uid INTEGER NOT NULL, mailbox TEXT NOT NULL, message_id TEXT, from_address TEXT, to_address TEXT,
			cc_address TEXT, subject TEXT, date TEXT, snippet TEXT, flags TEXT, has_body INTEGER DEFAULT 0,
			text_body TEXT, html_body TEXT, fetched_at TEXT, PRIMARY KEY (uid, mailbox)
		)
		""",
		"CREATE INDEX IF NOT EXISTS idx_mail_messages_mailbox ON mail_messages(mailbox)",
		"CREATE INDEX IF NOT EXISTS idx_mail_messages_date ON mail_messages(date DESC)",
		"CREATE TABLE IF NOT EXISTS mail_sync_state (mailbox TEXT PRIMARY KEY, last_uid INTEGER, last_synced_at TEXT)",
		"""
		CREATE TABLE IF NOT EXISTS mail_drafts (
			id TEXT PRIMARY KEY, to_address TEXT, cc_address TEXT, bcc_address TEXT, subject TEXT, body TEXT,
			created_at TEXT, updated_at TEXT
		)
		""",
	]

	/// Tables copied from the email plugin's cache.
	static let mailTables = [("drafts", "mail_drafts"), ("messages", "mail_messages"), ("sync_state", "mail_sync_state")]

	/// Tables copied from legacy `chat.sqlite`.
	static let chatTables = [
		"chat_sessions", "chat_session_messages", "chat_session_transcript",
		"chat_plans", "chat_plan_phases", "chat_external_sessions",
		"schedules", "schedule_runs", "projects",
		"flows", "flow_runs", "flow_run_nodes",
		"flow_trigger_decisions", "flow_trigger_state", "flow_trigger_cursor",
		"library_items", "library_embeddings", "library_references", "library_catalog_seen",
		"todo_entities", "todo_operations", "todo_requests", "todo_local",
	]

	/// Tables copied from legacy `memory.sqlite`.
	static let memoryTables = [
		"memory_items", "memory_sources", "memory_item_sources", "memory_proposals",
		"memory_embeddings", "memory_audit_log",
		"graph_nodes", "graph_edges", "graph_embeddings", "graph_enrich_queue", "graph_meta",
		"observations", "observation_cursors",
		"followup_loops", "followup_instructions", "followup_unit_hashes", "followup_feedback",
	]

	/// Legacy `todo-device.sqlite` table → Swift table.
	static let todoDeviceTables = [
		"files": "todo_device_files",
		"published": "todo_device_published",
		"state": "todo_device_state",
	]

	static let v1: [String] = [
		// MARK: Chat
		"""
		CREATE TABLE chat_sessions (
		  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		  last_pretreatment_json TEXT, settings_json TEXT, context_window_json TEXT, project_id TEXT)
		""",
		"CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at DESC)",
		"CREATE INDEX idx_chat_sessions_project ON chat_sessions(project_id)",
		"""
		CREATE TABLE chat_session_messages (
		  session_id TEXT NOT NULL, idx INTEGER NOT NULL, role TEXT NOT NULL,
		  content_json TEXT NOT NULL,
		  message_json TEXT,
		  PRIMARY KEY (session_id, idx),
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE)
		""",
		"""
		CREATE TABLE chat_session_transcript (
		  session_id TEXT NOT NULL, idx INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
		  PRIMARY KEY (session_id, idx),
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE)
		""",
		"""
		CREATE TABLE chat_plans (
		  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, goal TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE)
		""",
		"CREATE INDEX idx_chat_plans_session ON chat_plans(session_id)",
		"""
		CREATE TABLE chat_plan_phases (
		  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'pending', phase_order INTEGER NOT NULL, added_at TEXT NOT NULL,
		  FOREIGN KEY (plan_id) REFERENCES chat_plans(id) ON DELETE CASCADE)
		""",
		"""
		CREATE TABLE chat_external_sessions (
		  integration TEXT NOT NULL, external_key TEXT NOT NULL, session_id TEXT NOT NULL,
		  display_name TEXT, metadata_json TEXT, awaiting_ask_user_json TEXT, last_processed_message_id TEXT,
		  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		  lifecycle_status TEXT NOT NULL DEFAULT 'idle', active_since TEXT, ended_at TEXT, last_remote_message_at TEXT,
		  PRIMARY KEY (integration, external_key),
		  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE)
		""",
		// MARK: Schedules (legacy; superseded by flows but kept for history)
		"""
		CREATE TABLE schedules (
		  id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, persona_name TEXT NOT NULL,
		  cron_expression TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT,
		  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_id TEXT, flow_id TEXT)
		""",
		"""
		CREATE TABLE schedule_runs (
		  id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, persona_name TEXT NOT NULL, prompt TEXT NOT NULL,
		  output TEXT, transcript TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT,
		  started_at TEXT NOT NULL, completed_at TEXT,
		  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE)
		""",
		// MARK: Projects
		"""
		CREATE TABLE projects (
		  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
		  folder_path TEXT NOT NULL, persona_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
		""",
		// MARK: Flows
		"""
		CREATE TABLE flows (
		  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, persona_json TEXT,
		  definition_json TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0,
		  created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
		""",
		"""
		CREATE TABLE flow_runs (
		  id TEXT PRIMARY KEY, flow_name TEXT NOT NULL, status TEXT NOT NULL, persona_name TEXT,
		  provider TEXT, model TEXT, trigger TEXT, definition_snapshot_json TEXT NOT NULL,
		  initial_inputs_json TEXT, final_outputs_json TEXT, error TEXT, failed_node_id TEXT,
		  started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER, destination_results_json TEXT)
		""",
		"CREATE INDEX idx_flow_runs_started ON flow_runs(started_at DESC)",
		"CREATE INDEX idx_flow_runs_flow ON flow_runs(flow_name, started_at DESC)",
		"""
		CREATE TABLE flow_run_nodes (
		  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, node_type TEXT NOT NULL,
		  node_order INTEGER NOT NULL, status TEXT NOT NULL, inputs_json TEXT, outputs_json TEXT,
		  error TEXT, duration_ms INTEGER, started_at TEXT, completed_at TEXT, detail_json TEXT,
		  FOREIGN KEY (run_id) REFERENCES flow_runs(id) ON DELETE CASCADE)
		""",
		"CREATE INDEX idx_flow_run_nodes_run ON flow_run_nodes(run_id, node_order)",
		"""
		CREATE TABLE flow_trigger_decisions (
		  id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, flow_id TEXT NOT NULL, occurrence_id TEXT NOT NULL,
		  binding_json TEXT NOT NULL, event_json TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
		  flow_run_id TEXT, output TEXT, created_at TEXT NOT NULL,
		  UNIQUE(binding_id, occurrence_id))
		""",
		"CREATE TABLE flow_trigger_state (binding_id TEXT PRIMARY KEY, last_claim_at TEXT, claimed_day TEXT)",
		"CREATE TABLE flow_trigger_cursor (source TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL)",
		// MARK: Library
		"""
		CREATE TABLE library_items (
		  id TEXT PRIMARY KEY, title TEXT NOT NULL, original_filename TEXT NOT NULL, relative_path TEXT NOT NULL,
		  mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, content_hash TEXT NOT NULL,
		  description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT, source TEXT NOT NULL,
		  created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
		""",
		"CREATE INDEX idx_library_items_hash ON library_items(content_hash)",
		"CREATE INDEX idx_library_items_updated ON library_items(updated_at DESC)",
		"""
		CREATE TABLE library_embeddings (
		  item_id TEXT PRIMARY KEY, embedding_blob BLOB NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
		  FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE)
		""",
		"""
		CREATE TABLE library_references (
		  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, kind TEXT NOT NULL, session_id TEXT, project_id TEXT,
		  label TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
		  FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE)
		""",
		"""
		CREATE UNIQUE INDEX idx_library_references_origin ON library_references(
		  item_id, kind, IFNULL(session_id, ''), IFNULL(project_id, ''), IFNULL(detail, ''))
		""",
		"CREATE TABLE library_catalog_seen (origin_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, updated_at TEXT NOT NULL)",
		// MARK: Todos (operation log + materialized entities)
		"CREATE TABLE todo_entities (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind, id))",
		"CREATE TABLE todo_operations (id TEXT PRIMARY KEY, replica TEXT NOT NULL, clock INTEGER NOT NULL, data TEXT NOT NULL)",
		"CREATE TABLE todo_requests (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)",
		"CREATE TABLE todo_local (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		"CREATE TABLE todo_device_files (destination TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(destination, name))",
		"CREATE TABLE todo_device_published (destination TEXT NOT NULL, operation_id TEXT NOT NULL, PRIMARY KEY(destination, operation_id))",
		"CREATE TABLE todo_device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		// MARK: Memory
		"""
		CREATE TABLE memory_items (
		  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, subject TEXT, value TEXT NOT NULL,
		  confidence REAL NOT NULL DEFAULT 0.5, sensitivity TEXT NOT NULL DEFAULT 'normal',
		  visibility TEXT NOT NULL DEFAULT 'usable_by_ai', expires_at TEXT,
		  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, content_hash TEXT)
		""",
		"""
		CREATE TABLE memory_sources (
		  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, system TEXT NOT NULL, source_id TEXT, source_url TEXT,
		  observed_at TEXT NOT NULL, excerpt TEXT, metadata_json TEXT)
		""",
		"""
		CREATE TABLE memory_item_sources (
		  memory_id TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (memory_id, source_id),
		  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE,
		  FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE)
		""",
		"""
		CREATE TABLE memory_proposals (
		  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
		  candidate_json TEXT NOT NULL, source_id TEXT NOT NULL, confidence REAL NOT NULL,
		  sensitivity TEXT NOT NULL, suggested_visibility TEXT NOT NULL, reason TEXT NOT NULL,
		  rejection_reason TEXT, created_at TEXT NOT NULL, resolved_at TEXT,
		  FOREIGN KEY (source_id) REFERENCES memory_sources(id))
		""",
		"""
		CREATE TABLE memory_embeddings (
		  memory_id TEXT PRIMARY KEY, embedding_blob BLOB NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
		  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE)
		""",
		"""
		CREATE TABLE memory_audit_log (
		  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, memory_id TEXT, action TEXT NOT NULL,
		  detail_json TEXT, created_at TEXT NOT NULL)
		""",
		// MARK: Graph
		"""
		CREATE TABLE graph_nodes (
		  id TEXT PRIMARY KEY, type TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL,
		  props_json TEXT NOT NULL DEFAULT '{}', sensitivity TEXT NOT NULL DEFAULT 'normal',
		  visibility TEXT NOT NULL DEFAULT 'usable_by_ai', ref_table TEXT, ref_id TEXT,
		  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (type, key))
		""",
		"""
		CREATE TABLE graph_edges (
		  id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, type TEXT NOT NULL,
		  weight REAL NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 1,
		  origin TEXT NOT NULL DEFAULT 'deterministic', occurrences INTEGER NOT NULL DEFAULT 1,
		  provenance_node_id TEXT, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		  UNIQUE (src, dst, type))
		""",
		"CREATE INDEX idx_graph_edges_src ON graph_edges(src)",
		"CREATE INDEX idx_graph_edges_dst ON graph_edges(dst)",
		"""
		CREATE TABLE graph_embeddings (
		  node_id TEXT PRIMARY KEY, embedding_blob BLOB NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL)
		""",
		"""
		CREATE TABLE graph_enrich_queue (
		  node_id TEXT PRIMARY KEY, steps_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
		  last_error TEXT, enqueued_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL)
		""",
		"CREATE TABLE graph_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		// MARK: Observations + follow-ups
		"""
		CREATE TABLE observations (
		  id TEXT PRIMARY KEY, node_id TEXT NOT NULL, source_id TEXT NOT NULL, external_id TEXT NOT NULL,
		  kind TEXT NOT NULL, thread_key TEXT, direction TEXT, occurred_at TEXT NOT NULL, title TEXT NOT NULL,
		  excerpt TEXT, url TEXT, actors_json TEXT NOT NULL DEFAULT '[]', facts_json TEXT NOT NULL DEFAULT '{}',
		  content_hash TEXT NOT NULL, ingested_at TEXT NOT NULL, UNIQUE (source_id, external_id))
		""",
		"CREATE INDEX idx_observations_occurred ON observations(occurred_at DESC)",
		"""
		CREATE TABLE observation_cursors (
		  source_id TEXT PRIMARY KEY, since TEXT, last_run_at TEXT, last_success_at TEXT, last_error TEXT,
		  self_json TEXT NOT NULL DEFAULT '{}', ingested_count INTEGER NOT NULL DEFAULT 0)
		""",
		"""
		CREATE TABLE followup_loops (
		  loop_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
		  title TEXT NOT NULL, counterpart TEXT, due_at TEXT, confidence REAL NOT NULL, todo_id TEXT,
		  resolution_rejected INTEGER NOT NULL DEFAULT 0, reopened_at TEXT, last_evaluated_hash TEXT,
		  last_activity_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
		""",
		"CREATE TABLE followup_instructions (id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
		"CREATE TABLE followup_unit_hashes (unit_id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, evaluated_at TEXT NOT NULL)",
		"""
		CREATE TABLE followup_feedback (
		  id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL)
		""",
		// MARK: Import bookkeeping
		"""
		CREATE TABLE legacy_import_log (
		  step TEXT PRIMARY KEY, version INTEGER NOT NULL, rows INTEGER NOT NULL, detail TEXT, imported_at TEXT NOT NULL)
		""",
	]
}
