import Carbon.HIToolbox
import Foundation

/// A user-configurable system-wide keyboard shortcut, persisted to UserDefaults.
///
/// Stores the Carbon key code and modifier flags so `RegisterEventHotKey` can
/// register the shortcut directly, plus a display string for the Settings UI.
struct GlobalKeyboardShortcut: Codable, Equatable, Hashable, Sendable {
	/// Carbon virtual key code (kVK_*).
	var keyCode: UInt32
	/// Carbon modifier flags (combination of cmdKey, shiftKey, optionKey, controlKey).
	var modifiers: UInt32
	/// Human-readable label captured when the shortcut was recorded (e.g. "⌘⇧K").
	var displayText: String

	/// `true` when at least one modifier is set (required for a global hotkey).
	var hasRequiredModifiers: Bool { modifiers != 0 }

	/// Encodes this shortcut as a stable UserDefaults JSON string.
	var persistedValue: String? {
		let data = try? JSONEncoder().encode(self)
		return data.flatMap { String(data: $0, encoding: .utf8) }
	}

	/// Decodes a shortcut from a UserDefaults JSON string.
	static func from(persistedValue: String?) -> GlobalKeyboardShortcut? {
		guard let value = persistedValue,
			let data = value.data(using: .utf8)
		else { return nil }
		return try? JSONDecoder().decode(GlobalKeyboardShortcut.self, from: data)
	}
}
