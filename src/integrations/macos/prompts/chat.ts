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

- **Wi‑Fi**: **macWifiScanNearby** (\`airport\` when it works, otherwise **system_profiler SPAirPortDataType** — check \`scanSource\`). Power: **macWifiSetPower** / **macWifiStatus** via \`networksetup\`; en* from hardware scan or **macos.wifiPreferredDevice**.
- **Audio**: **macAudioListOutputs** returns both **outputs** and **inputs**. For "switch/change/set audio output", call **macAudioSwitchOutput** when the target is known. If unclear, call **macAudioListOutputs**, then either choose the clear output match and call **macAudioSwitchOutput**, or call **askUser** with exact output names. Do **not** stop after only listing when the user requested a switch.
- **Bluetooth**: \`blueutil\` (\`brew install blueutil\`) or Shortcut fields + **macShortcutsRun**.
- **Focus / Do Not Disturb**: usually Shortcuts mapped in Configure; run **macShortcutsRun**.
- **Low power**: read **macLowPowerModeStatus**; set **macLowPowerModeSet** may need privileges — Shortcuts fallback.
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
