import { daemonLog } from "../logging/daemon-log";
import { handleWebRequest } from "./routes";
import { getWebUiUrl, resolveWebStaticDir } from "./static-path";

export interface WebServerOptions {
	readonly port: number;
	readonly signal: AbortSignal;
	readonly staticDir?: string | null;
}

export function startWebServer(options: WebServerOptions): Promise<void> {
	const { port, signal } = options;
	const staticDir =
		options.staticDir === undefined ? resolveWebStaticDir() : options.staticDir;

	return new Promise((resolve, reject) => {
		let server: ReturnType<typeof Bun.serve> | undefined;

		const onAbort = () => {
			daemonLog("info", "daemon", "web_server_stopping", { port });
			server?.stop(true);
			resolve();
		};

		if (signal.aborted) {
			resolve();
			return;
		}

		signal.addEventListener("abort", onAbort, { once: true });

		try {
			server = Bun.serve({
				hostname: "127.0.0.1",
				port,
				idleTimeout: 255,
				async fetch(req: Request) {
					try {
						return await handleWebRequest(req, staticDir);
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						daemonLog("error", "daemon", "web_request_error", { message });
						return new Response(JSON.stringify({ error: message }), {
							status: 500,
							headers: { "Content-Type": "application/json" },
						});
					}
				},
			});

			daemonLog("info", "daemon", "web_server_started", {
				port,
				url: getWebUiUrl(port),
				staticDir: staticDir ?? null,
			});
		} catch (e) {
			signal.removeEventListener("abort", onAbort);
			reject(e);
		}
	});
}

export { getWebUiUrl, resolveWebStaticDir };
