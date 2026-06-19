import { getWebConfig } from "@toby/core/config/index";
import { TobyDaemonClient, resolveDaemonBaseUrl } from "@toby/core/web/client";
import { ensureDaemonRunning } from "../schedules/daemon-status";

export type TranscribeRecordingResult =
	| {
			readonly ok: true;
			readonly transcript?: string;
			readonly transcriptError?: string;
	  }
	| { readonly ok: false; readonly error: string };

export async function transcribeRecordingViaDaemon(
	recordingId: string,
	recordingsDir?: string,
): Promise<TranscribeRecordingResult> {
	const web = getWebConfig();
	if (!web.enabled) {
		return { ok: false, error: "Web API is disabled." };
	}
	const daemon = await ensureDaemonRunning();
	if (!daemon.running) {
		return { ok: false, error: "Could not start Toby daemon." };
	}
	const client = new TobyDaemonClient({
		baseUrl: resolveDaemonBaseUrl(web.port),
	});
	try {
		const result = await client.transcribeRecording(recordingId, recordingsDir);
		return {
			ok: true,
			transcript: result.transcript,
			transcriptError: result.transcriptError,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}
