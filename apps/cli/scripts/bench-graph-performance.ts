import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const nodeCount = 50_000;
const edgesPerNode = 6;
const previousTobyDir = process.env.TOBY_DIR;
const tobyDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-graph-bench-"));
process.env.TOBY_DIR = tobyDir;

let closeMemoryDb: (() => void) | undefined;
try {
	const memory = await import("../../../packages/core/src/memory/memory-store");
	closeMemoryDb = memory.closeMemoryDb;
	const openedAt = performance.now();
	const db = memory.getDb();
	const openMs = performance.now() - openedAt;
	const stamp = new Date().toISOString();
	const insertNode = db.query(`INSERT INTO graph_nodes
		(id, type, key, label, props_json, sensitivity, visibility, ref_table, ref_id, created_at, updated_at)
		VALUES ($id, 'topic', $key, $label, '{}', 'normal', 'usable_by_ai', NULL, NULL, $at, $at)`);
	const insertEdge = db.query(`INSERT INTO graph_edges
		(id, src, dst, type, weight, confidence, origin, occurrences, provenance_node_id, reason, created_at, updated_at)
		VALUES ($id, $src, $dst, 'about', 1, 1, 'deterministic', 1, NULL, NULL, $at, $at)`);

	const idFor = (index: number) =>
		`bench-node-${String(index).padStart(5, "0")}`;
	const seedAt = performance.now();
	db.transaction(() => {
		for (let index = 0; index < nodeCount; index++) {
			const id = idFor(index);
			insertNode.run({ $id: id, $key: id, $label: id, $at: stamp });
		}
		for (let index = 0; index < nodeCount; index++) {
			for (let offset = 1; offset <= edgesPerNode; offset++) {
				const next = (index + offset) % nodeCount;
				insertEdge.run({
					$id: `bench-edge-${String(index * edgesPerNode + offset - 1).padStart(6, "0")}`,
					$src: idFor(index),
					$dst: idFor(next),
					$at: stamp,
				});
			}
		}
	})();
	const seedMs = performance.now() - seedAt;

	const { neighbors } = await import("../../../packages/core/src/graph/query");
	const { graphCounts } = await import(
		"../../../packages/core/src/graph/store"
	);
	const queryAt = performance.now();
	const found = neighbors(idFor(0), { depth: 2, limit: 100 });
	const neighborMs = performance.now() - queryAt;

	const { writeGraph } = await import("../../../packages/core/src/graph/write");
	const batchNodes = Array.from({ length: 500 }, (_, index) => ({
		type: "topic" as const,
		key: `write-batch:${index}`,
		label: `Write batch ${index}`,
	}));
	const batchEdges = [];
	for (let index = 0; index < batchNodes.length; index++) {
		const source = batchNodes[index];
		if (!source) throw new Error("Missing synthetic batch source");
		for (let offset = 1; offset <= edgesPerNode; offset++) {
			const destination = batchNodes[(index + offset) % batchNodes.length];
			if (!destination) throw new Error("Missing synthetic batch destination");
			batchEdges.push({
				src: source,
				dst: destination,
				type: "about" as const,
			});
		}
	}
	const writeAt = performance.now();
	const written = writeGraph({ nodes: batchNodes, edges: batchEdges });
	const batchWriteMs = performance.now() - writeAt;
	const counts = graphCounts();

	console.log(
		JSON.stringify(
			{
				dataset: { nodes: nodeCount, edges: nodeCount * edgesPerNode },
				startupSchemaMs: Number(openMs.toFixed(2)),
				seedMs: Number(seedMs.toFixed(2)),
				neighbors2Hop: {
					milliseconds: Number(neighborMs.toFixed(2)),
					results: found.length,
				},
				batchWrite: {
					nodes: batchNodes.length,
					edges: batchEdges.length,
					milliseconds: Number(batchWriteMs.toFixed(2)),
					writtenNodes: written.nodeIds.length,
					writtenEdges: written.edgeIds.length,
				},
				finalCounts: counts,
			},
			null,
			2,
		),
	);
} finally {
	closeMemoryDb?.();
	fs.rmSync(tobyDir, { recursive: true, force: true });
	if (previousTobyDir === undefined)
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previousTobyDir;
}
