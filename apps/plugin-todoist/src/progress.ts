/**
 * Live transcript progress for the running tool call. Toby core reads these
 * stderr lines and renders them as transient sub-items under the step.
 */
export type ProgressItem = {
	readonly id: string;
	readonly label: string;
	readonly state: "waiting" | "running" | "done" | "failed";
	readonly detail?: string;
};

export function emitProgress(update: {
	readonly items?: readonly ProgressItem[];
	readonly fraction?: number;
}): void {
	process.stderr.write(`@@toby-progress ${JSON.stringify(update)}\n`);
}
