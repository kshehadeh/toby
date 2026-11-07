import fs from "node:fs";
import path from "node:path";
import { ensureTobyDir, resolveTobyDir } from "../config/index";

function markerPath() {
	return path.join(resolveTobyDir(), "todo-restore-review.json");
}

/** Machine-local, deliberately outside the restored databases. */
export function pauseTodosAfterRestore(): void {
	ensureTobyDir();
	fs.writeFileSync(
		markerPath(),
		JSON.stringify({ restoredAt: new Date().toISOString() }),
		{ mode: 0o600 },
	);
}
export function todosNeedRestoreReview(): boolean {
	return fs.existsSync(markerPath());
}
export function acknowledgeTodoRestore(): void {
	fs.rmSync(markerPath(), { force: true });
}
