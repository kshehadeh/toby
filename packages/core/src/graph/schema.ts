type ExecDb = {
	exec: (sql: string) => void;
	query?: (sql: string) => { all: () => unknown[] };
};

/** Graph tables share memory.sqlite so memory writes and graph links commit together. */
export function ensureGraphSchema(db: ExecDb): void {
	db.exec(`
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  visibility TEXT NOT NULL DEFAULT 'usable_by_ai',
  ref_table TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, key)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_ref ON graph_nodes(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type_updated ON graph_nodes(type, updated_at);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 1,
  origin TEXT NOT NULL DEFAULT 'deterministic',
  occurrences INTEGER NOT NULL DEFAULT 1,
  provenance_node_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (src, dst, type)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(src, type, weight);
CREATE INDEX IF NOT EXISTS idx_graph_edges_dst ON graph_edges(dst, type, weight);
CREATE INDEX IF NOT EXISTS idx_graph_edges_provenance ON graph_edges(provenance_node_id);

CREATE TABLE IF NOT EXISTS graph_embeddings (
  node_id TEXT PRIMARY KEY,
  embedding_blob BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_enrich_queue (
  node_id TEXT PRIMARY KEY,
  steps_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_enrich_queue_next ON graph_enrich_queue(next_attempt_at);

CREATE TABLE IF NOT EXISTS graph_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  thread_key TEXT,
  direction TEXT,
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  url TEXT,
  actors_json TEXT NOT NULL DEFAULT '[]',
  facts_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_observations_thread ON observations(thread_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_observations_ingested ON observations(ingested_at);
CREATE INDEX IF NOT EXISTS idx_observations_occurred ON observations(occurred_at);
CREATE INDEX IF NOT EXISTS idx_observations_node ON observations(node_id);

CREATE TABLE IF NOT EXISTS observation_cursors (
  source_id TEXT PRIMARY KEY,
  since TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  self_json TEXT NOT NULL DEFAULT '{}',
  ingested_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS followup_loops (
  loop_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  counterpart TEXT,
  due_at TEXT,
  confidence REAL NOT NULL,
  todo_id TEXT,
  resolution_rejected INTEGER NOT NULL DEFAULT 0,
  reopened_at TEXT,
  last_evaluated_hash TEXT,
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followup_loops_status ON followup_loops(status, due_at);
CREATE INDEX IF NOT EXISTS idx_followup_loops_todo ON followup_loops(todo_id);

CREATE TABLE IF NOT EXISTS followup_instructions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followup_unit_hashes (
  unit_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followup_feedback (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followup_feedback_fingerprint ON followup_feedback(fingerprint, created_at);
`);
	const edgeColumns = db.query?.("PRAGMA table_info(graph_edges)");
	if (
		edgeColumns &&
		!(edgeColumns.all() as Array<{ name: string }>).some(
			(column) => column.name === "reason",
		)
	) {
		db.exec("ALTER TABLE graph_edges ADD COLUMN reason TEXT");
	}
	const loopColumns = db.query?.("PRAGMA table_info(followup_loops)");
	if (
		loopColumns &&
		!(loopColumns.all() as Array<{ name: string }>).some(
			(column) => column.name === "reopened_at",
		)
	) {
		db.exec("ALTER TABLE followup_loops ADD COLUMN reopened_at TEXT");
	}
}
