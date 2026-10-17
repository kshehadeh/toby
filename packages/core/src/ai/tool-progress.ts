import { AsyncLocalStorage } from "node:async_hooks";
import type {
	ToolProgressItem,
	ToolProgressUpdate,
} from "../chat-pipeline/tool-presentation";

export type ToolProgressReporter = (update: ToolProgressUpdate) => void;

const storage = new AsyncLocalStorage<ToolProgressReporter>();

/**
 * Run a tool's `execute` with a progress reporter bound to its call, so code
 * deep in the tool can call {@link reportToolProgress} without threading ids.
 */
export function runWithToolProgress<T>(
	reporter: ToolProgressReporter,
	fn: () => Promise<T>,
): Promise<T> {
	return storage.run(reporter, fn);
}

/**
 * Report transient progress for the currently executing tool call. No-op when
 * called outside a chat tool call (CLI, flows, tests).
 */
export function reportToolProgress(update: ToolProgressUpdate): void {
	storage.getStore()?.(update);
}

/**
 * Capture the current call's reporter. Use before handing work to callbacks
 * that run outside the async context (child-process stream listeners).
 */
export function currentToolProgressReporter():
	| ToolProgressReporter
	| undefined {
	return storage.getStore();
}

/**
 * Accumulates item upserts so every emitted event carries the full rail,
 * letting clients replace state instead of merging.
 */
export function createToolProgressAccumulator(
	emit: (update: { items: ToolProgressItem[]; fraction?: number }) => void,
): ToolProgressReporter {
	const items: ToolProgressItem[] = [];
	let fraction: number | undefined;
	return (update) => {
		for (const item of update.items ?? []) {
			if (
				!item ||
				typeof item.id !== "string" ||
				typeof item.label !== "string"
			) {
				continue;
			}
			const index = items.findIndex((existing) => existing.id === item.id);
			if (index >= 0) {
				items[index] = item;
			} else {
				items.push(item);
			}
		}
		if (
			typeof update.fraction === "number" &&
			Number.isFinite(update.fraction)
		) {
			fraction = Math.min(1, Math.max(0, update.fraction));
		}
		emit({
			items: [...items],
			...(fraction !== undefined ? { fraction } : {}),
		});
	};
}
