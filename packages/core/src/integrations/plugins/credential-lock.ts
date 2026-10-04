// Rotating refresh tokens are single-use. Serialize daemon health checks and
// tool invocations for an integration, including reading and saving credentials.
const pending = new Map<string, Promise<void>>();

export async function withPluginCredentialLock<T>(
	name: string,
	run: () => Promise<T>,
): Promise<T> {
	const previous = pending.get(name) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	pending.set(name, current);
	await previous;
	try {
		return await run();
	} finally {
		release();
		if (pending.get(name) === current) pending.delete(name);
	}
}
