import Carbon.HIToolbox
import Foundation

/// Actions that can be triggered by a system-wide global hotkey.
enum GlobalHotkeyAction: String, CaseIterable, Identifiable, Sendable, Codable {
	case commandPalette
	case toggleRecording
	case newChat
	case askCompanion

	var id: String { rawValue }

	static let companionDefaultShortcut = GlobalKeyboardShortcut(
		keyCode: UInt32(kVK_Space), modifiers: UInt32(controlKey | optionKey), displayText: "⌃⌥Space"
	)

	var displayName: String {
		switch self {
		case .commandPalette: "Command palette"
		case .toggleRecording: "Start/stop recording"
		case .newChat: "New chat"
		case .askCompanion: "Ask Toby’s Head"
		}
	}

	var description: String {
		switch self {
		case .commandPalette:
			"Summon Toby's command palette from anywhere, like Spotlight."
		case .toggleRecording:
			"Start or stop an audio recording without switching to Toby."
		case .newChat:
			"Bring Toby to the front and start a fresh chat session."
		case .askCompanion:
			"Show Toby’s Head and focus its chat bubble from anywhere. Default: ⌃⌥Space."
		}
	}

	/// The notification posted when this hotkey fires.
	var notificationName: Notification.Name {
		switch self {
		case .commandPalette: .openCommandPalette
		case .toggleRecording: .menuBarToggleRecording
		case .newChat: .startNewChat
		case .askCompanion: .askCompanion
		}
	}

	/// Unique Carbon hotkey ID used to distinguish which action was pressed.
	var hotkeyId: UInt32 {
		switch self {
		case .commandPalette: 1
		case .toggleRecording: 2
		case .newChat: 3
		case .askCompanion: 4
		}
	}
}
