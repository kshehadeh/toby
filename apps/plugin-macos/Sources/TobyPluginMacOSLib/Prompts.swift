import Foundation

public enum Prompts {
	public static func buildChatModelPrep() -> [String: Any] {
		[
			"systemPromptSection": """
			### Local macOS
			Use mac* tools — Wi‑Fi scan & power, Bluetooth, battery info, audio list/switch/volume/mute, display brightness, clipboard read/write, pmset Low Power probes, Focus/Do Not Disturb, Shortcut runner, unsupported notifications ack.

			Audio rule: **macAudioListOutputs** returns both outputs and inputs. When the user asks to switch/change/set the output device, use **macAudioSwitchOutput** once the target is known. Use **macAudioListOutputs** only to discover exact names; do not stop after listing if there is a clear output match.

			Focus rule: When the user asks to turn on/off Do Not Disturb or Focus mode, call **macFocusSet** with `enabled: true` or `false`. Do not claim Focus is unsupported — there is no direct API, but Toby ships bundled Shortcuts ("Toby Focus On" / "Toby Focus Off"). If the shortcut is missing, tell the user to run `toby plugins setup macos` and confirm the import in Shortcuts.app. Use **macNotificationsPeek** only to acknowledge that Notification Center items cannot be listed — never for toggling Focus.

			Windows rule: For requests to hide, show, or minimize windows on this Mac, use **macWindowsHideAll** / **macWindowsShowAll** / **macWindowsMinimizeAll** for global actions, and **macWindowHideApp** / **macWindowMinimizeApp** when the user names a specific app. Hide/show work without extra permission; the minimize tools require the macOS Accessibility permission and will return a clear hint if it is not granted yet.
			""",
			"buildMultiUserContent": """
			## Local macOS
			Use mac tools for system changes on **this Mac** (Darwin only).
			""",
		]
	}

	public static func buildChatReadiness(state: [String: Any]) -> [String: Any] {
		if !SystemClient.isPlatformSupported {
			return ["ok": false, "hint": "macOS integration runs only on macOS hosts."]
		}
		if PluginOutput.isConnected(state: state) {
			return ["ok": true]
		}
		return [
			"ok": false,
			"hint": "Run `toby connect macos` on this Mac to enable macOS automation tools.",
		]
	}
}
