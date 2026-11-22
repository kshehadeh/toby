import { getDb } from "../memory/memory-store";
import { entityNameKey } from "./keys";
import type { GraphNodeInput } from "./types";
import { writeGraph } from "./write";

const MIGRATION_KEY = "memory_graph_backfill_v1";
const BATCH_SIZE = 200;

/** Idempotently mirror all pre-graph memory rows and queue usable items. */
export function backfillMemoryGraph(
	params: { readonly force?: boolean } = {},
): { readonly queued: number; readonly complete: boolean } {
	const db = getDb();
	const done = db
		.query("SELECT value FROM graph_meta WHERE key = $key")
		.get({ $key: MIGRATION_KEY }) as { value: string } | undefined;
	if (!params.force && done?.value === "complete")
		return { queued: 0, complete: true };
	const rows = db
		.query(
			`SELECT id, type, subject, value, sensitivity, visibility, expires_at
       FROM memory_items ORDER BY id`,
		)
		.all() as Array<{
		id: string;
		type: string;
		subject: string | null;
		value: string;
		sensitivity: string;
		visibility: string;
		expires_at: string | null;
	}>;
	let queued = 0;
	for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
		const batch = rows.slice(offset, offset + BATCH_SIZE);
		for (const row of batch) {
			const subject = row.subject?.trim();
			const node: GraphNodeInput = {
				type: "memory",
				key: row.id,
				label: subject || row.value.trim().slice(0, 80),
				props: {
					memoryType: row.type,
					text: row.value.slice(0, 1000),
					subject: subject ?? null,
					expiresAt: row.expires_at,
				},
				sensitivity: row.sensitivity as GraphNodeInput["sensitivity"],
				visibility: row.visibility as GraphNodeInput["visibility"],
				ref: { table: "memory_items", id: row.id },
			};
			const canEnrich = row.visibility === "usable_by_ai";
			writeGraph({
				nodes: [node],
				...(row.visibility === "usable_by_ai" && subject
					? {
							edges: [
								{
									src: node,
									dst: {
										type: "person" as const,
										key: entityNameKey(subject),
										label: subject,
									},
									type: "about" as const,
								},
							],
						}
					: {}),
				...(canEnrich ? { enrich: ["embed", "extract"] as const } : {}),
			});
			if (canEnrich) queued++;
		}
	}
	db.query(
		`INSERT INTO graph_meta(key, value) VALUES($key, 'complete')
     ON CONFLICT(key) DO UPDATE SET value = 'complete'`,
	).run({ $key: MIGRATION_KEY });
	return { queued, complete: true };
}
