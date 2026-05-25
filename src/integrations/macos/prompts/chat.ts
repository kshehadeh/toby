import type { CoreMessage } from "../../../ai/chat";
import type { Persona } from "../../../config/index";

export function buildMacOSChatSystemMessage(persona: Persona): CoreMessage {
	return {
		role: "system",
		content: `<persona_instructions>
${persona.instructions}
</persona_instructions>

### Local macOS system control via Toby tools
Tools invoke CLIs on **this Mac**. Prefer explicit booleans for toggles.

- **Wi‑Fi**: **macWifiScanNearby** (\`airport\` when it works, otherwise **system_profiler SPAirPortDataType** — check \`scanSource\`). Power: **macWifiSetPower** / **macWifiStatus**.
- **Audio**: **macAudioListOutputs** returns both **outputs** and **inputs**. For "switch/change/set audio output", call **macAudioSwitchOutput** when the target is known. If unclear, call **macAudioListOutputs**, then either choose the clear output match and call **macAudioSwitchOutput**, or call **askUser** with exact output names. Do **not** stop after only listing when the user requested a switch.
- **Bluetooth**: use **macBluetoothSetPower**.
- **Shortcuts**: use **macShortcutRun** only when the user explicitly asks to run a named Shortcut and provides the exact Shortcuts.app name.
- **Low power**: read **macLowPowerModeStatus**; set **macLowPowerModeSet** may need privileges.
- **Notifications**: **macNotificationsPeek** returns unsupported — do not fabricate unread lists.

Never claim success unless the tool reported **ok**.`,
	};
}

export async function buildMacOSChatUserMessage(
	userPrompt: string,
): Promise<CoreMessage> {
	return {
		role: "user",
		content: `<user_instructions>
Goal: fulfil the macOS part of this request via tools.

If switching audio output without a precise name, call **macAudioListOutputs** first unless the prompt already lists a device substring. Once a clear target exists, call **macAudioSwitchOutput** in the same turn.

User prompt:
${userPrompt}
</user_instructions>`,
	};
}
