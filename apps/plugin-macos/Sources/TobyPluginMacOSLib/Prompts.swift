import Foundation

public enum Prompts {
	public static func buildChatModelPrep() -> [String: Any] {
		[
			"systemPromptSection": """
			### Local macOS
			Use mac* tools — Wi‑Fi scan & power, Bluetooth, battery info, audio list/switch/volume/mute, display brightness, clipboard read/write, pmset Low Power probes, Shortcut runner, unsupported notifications ack.

			Audio rule: **macAudioListOutputs** returns both outputs and inputs. When the user asks to switch/change/set the output device, use **macAudioSwitchOutput** once the target is known. Use **macAudioListOutputs** only to discover exact names; do not stop after listing if there is a clear output match.
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
