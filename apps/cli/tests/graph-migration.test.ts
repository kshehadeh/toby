import { describe, expect, it } from "bun:test";
import { ensureGraphSchema } from "@toby/core/graph/schema";

type MigrationDb = {
	exec: (sql: string) => void;
	query: (sql: string) => { all: () => unknown[] };
	close: () => void;
};

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

describe.skipIf(!isBun)("graph schema migrations", () => {
	it("creates fresh schema and upgrades databases missing added columns", () => {
		const Database = (
			require("bun:sqlite") as {
				Database: new (path: string) => MigrationDb;
			}
		).Database;
		const fresh = new Database(":memory:");
		try {
			ensureGraphSchema(fresh);
			const edgeColumns = fresh
				.query("PRAGMA table_info(graph_edges)")
				.all() as Array<{ name: string }>;
			const loopColumns = fresh
				.query("PRAGMA table_info(followup_loops)")
				.all() as Array<{ name: string }>;
			expect(edgeColumns.map((column) => column.name)).toContain("reason");
			expect(loopColumns.map((column) => column.name)).toContain("reopened_at");
		} finally {
			fresh.close();
		}

		const upgraded = new Database(":memory:");
		try {
			upgraded.exec(`
CREATE TABLE graph_edges (
	id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, type TEXT NOT NULL,
	weight REAL NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 1,
	origin TEXT NOT NULL DEFAULT 'deterministic', occurrences INTEGER NOT NULL DEFAULT 1,
	provenance_node_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
	UNIQUE (src, dst, type)
);
CREATE TABLE followup_loops (
	loop_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
	fingerprint TEXT NOT NULL UNIQUE, title TEXT NOT NULL, counterpart TEXT,
	due_at TEXT, confidence REAL NOT NULL, todo_id TEXT,
	resolution_rejected INTEGER NOT NULL DEFAULT 0, last_evaluated_hash TEXT,
	last_activity_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`);
			ensureGraphSchema(upgraded);
			const edgeColumns = upgraded
				.query("PRAGMA table_info(graph_edges)")
				.all() as Array<{ name: string }>;
			const loopColumns = upgraded
				.query("PRAGMA table_info(followup_loops)")
				.all() as Array<{ name: string }>;
			expect(edgeColumns.map((column) => column.name)).toContain("reason");
			expect(loopColumns.map((column) => column.name)).toContain("reopened_at");
		} finally {
			upgraded.close();
		}
	});
});
