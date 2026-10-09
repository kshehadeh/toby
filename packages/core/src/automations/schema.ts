export const AUTOMATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, definition_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_events (id TEXT PRIMARY KEY, event_json TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_state (automation_id TEXT PRIMARY KEY, last_claim_at TEXT, claimed_day TEXT);
CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, event_id TEXT NOT NULL, definition_json TEXT NOT NULL, event_json TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, flow_run_id TEXT, output TEXT, created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(automation_id, event_id));
CREATE INDEX IF NOT EXISTS automation_runs_status ON automation_runs(status, created_at);
CREATE INDEX IF NOT EXISTS automation_runs_owner ON automation_runs(automation_id, created_at);
CREATE TABLE IF NOT EXISTS automation_cursor (source TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL);
`;
