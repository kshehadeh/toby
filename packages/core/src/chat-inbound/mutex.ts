const chains = new Map<string, Promise<void>>();

/**
 * Serialize async work per key (e.g. one external conversation at a time).
 */
export async function withConversationMutex<T>(
	key: string,
	fn: () => Promise<T>,
): Promise<T> {
	const prev = chains.get(key) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	chains.set(
		key,
		prev.then(() => gate),
	);
	await prev;
	try {
		return await fn();
	} finally {
		release();
		const current = chains.get(key);
		if (current === gate) {
			chains.delete(key);
		}
	}
}
