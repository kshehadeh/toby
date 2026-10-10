import { isNativeAvailable } from "./native-client";
import { isConnected } from "./protocol";

type JsonRecord = Record<string, unknown>;

type ChatModelPrep = {
	readonly systemPromptSection: string;
	readonly singleSessionRules: string;
	readonly singleSessionUserTemplate: string;
	readonly multiUserContentTemplate: string;
};

export function buildChatModelPrep(): ChatModelPrep {
	const systemPromptSection = `### Local macOS
Use mac* tools — Wi‑Fi scan & power, Bluetooth, battery info, audio list/switch/volume/mute, display brightness, clipboard read/write, pmset Low Power probes, Focus/Do Not Disturb, Shortcut runner, system notification display, unsupported notifications ack.

Files rule: Use **macFilesList** to discover files in Downloads, Desktop, Documents, or a named absolute folder. Set \`kind: "images"\` to list image files. Follow \`nextOffset\` when more matches exist. This lists filenames and metadata, not image previews or file contents. Use the returned paths with image tools when requested. Report permission errors from the tool accurately; do not promise folder access before a successful listing.

Audio rule: **macAudioListOutputs** returns both outputs and inputs. When the user asks to switch/change/set the output device, use **macAudioSwitchOutput** once the target is known. Use **macAudioListOutputs** only to discover exact names; do not stop after listing if there is a clear output match.

Focus rule: When the user asks to turn on/off Do Not Disturb or Focus mode, call **macFocusSet** with \`enabled: true\` or \`false\`. Do not claim Focus is unsupported — there is no direct API, but Toby ships bundled Shortcuts ("TobyFocusOn" / "TobyFocusOff"). If the shortcut is missing, tell the user to run \`toby plugins setup macos\` and confirm the import in Shortcuts.app. Use **macNotificationsPeek** only to acknowledge that Notification Center items cannot be listed — never for toggling Focus.

Notification rule: When the user asks Toby to display/send/show a local macOS system notification, call **macNotificationShow** with a title, description, and optional CTA button labels. Use **macNotificationsPeek** only for reading existing Notification Center items, which is unsupported.

Applications rule: Use **macAppsRunning** to list running apps or inspect a named app. Set \`includeBackground: true\` for menu bar/background apps. The returned \`secondsSinceLastFocus\` is 0 while active, elapsed seconds since losing focus otherwise, or null when unknown. History only covers the current Toby session; never interpret null as never used. Use **macAppQuit** to quit a named app by exact name or bundle ID; use the list to resolve unclear names. A successful quit result only confirms the request was sent: apps can show save prompts or cancel quitting. Never report that an app exited unless a later list confirms it.

Windows rule: For requests to hide, show, minimize, or unminimize windows on this Mac, use **macWindowsHideAll** / **macWindowsShowAll** / **macWindowsMinimizeAll** / **macWindowsUnminimizeAll** for global actions, and **macWindowHideApp** / **macWindowMinimizeApp** / **macWindowUnminimizeApp** when the user names a specific app. Hide/show work without extra permission; the minimize/unminimize tools require the macOS Accessibility permission and will return a clear hint if it is not granted yet.`;
	return {
		systemPromptSection,
		singleSessionRules: systemPromptSection,
		singleSessionUserTemplate: "{{userPrompt}}",
		multiUserContentTemplate: `## Local macOS
Use mac tools for system changes on **this Mac** (Darwin only).

User request: {{userPrompt}}
`,
	};
}

export function buildChatReadiness(state: JsonRecord): JsonRecord {
	if (!isNativeAvailable()) {
		return {
			ok: false,
			hint: "Toby.app is not running. Launch Toby.app to enable macOS automation tools.",
		};
	}
	if (isConnected(state)) {
		return { ok: true };
	}
	return {
		ok: false,
		hint: "Run `toby connect macos` on this Mac to enable macOS automation tools.",
	};
}
