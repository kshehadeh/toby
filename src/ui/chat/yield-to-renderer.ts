type InkRenderFlush = () => Promise<void>;

let inkRenderFlush: InkRenderFlush | null = null;

/** Called from `runChatSessionInk` so boot progress can flush Ink frames. */
export function registerInkRenderFlush(flush: InkRenderFlush): void {
	inkRenderFlush = flush;
}

export function unregisterInkRenderFlush(): void {
	inkRenderFlush = null;
}

/**
 * Yields to the event loop and waits for Ink to commit output.
 * setState alone is not enough — Ink may not paint until `waitUntilRenderFlush`.
 */
export async function yieldToRenderer(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
	if (inkRenderFlush) {
		await inkRenderFlush();
	}
}
