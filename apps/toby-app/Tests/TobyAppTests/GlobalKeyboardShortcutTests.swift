import Carbon.HIToolbox
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("GlobalKeyboardShortcut")
struct GlobalKeyboardShortcutTests {
	@Test("defaults to empty shortcuts when unset")
	func defaultsToEmptyWhenUnset() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(prefs.shortcut(for: .commandPalette) == nil)
		#expect(prefs.shortcut(for: .toggleRecording) == nil)
		#expect(prefs.shortcut(for: .newChat) == nil)
		#expect(prefs.globalShortcuts.isEmpty)
	}

	@Test("persists and reloads a shortcut")
	func persistsAndReloads() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let shortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_K),
			modifiers: UInt32(cmdKey),
			displayText: "⌘K"
		)
		prefs.setShortcut(shortcut, for: .commandPalette)
		#expect(prefs.shortcut(for: .commandPalette) == shortcut)

		let reloaded = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(reloaded.shortcut(for: .commandPalette) == shortcut)
		#expect(reloaded.shortcut(for: .commandPalette)?.displayText == "⌘K")
	}

	@Test("clearing a shortcut removes it from UserDefaults")
	func clearingRemovesShortcut() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		prefs.setShortcut(
			GlobalKeyboardShortcut(
				keyCode: UInt32(kVK_ANSI_K),
				modifiers: UInt32(cmdKey),
				displayText: "⌘K"
			),
			for: .commandPalette
		)
		#expect(prefs.shortcut(for: .commandPalette) != nil)
		prefs.setShortcut(nil, for: .commandPalette)
		#expect(prefs.shortcut(for: .commandPalette) == nil)

		let reloaded = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(reloaded.shortcut(for: .commandPalette) == nil)
	}

	@Test("shortcuts without modifiers are rejected on init")
	func shortcutsWithoutModifiersAreRejected() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		var badDict: [GlobalHotkeyAction: GlobalKeyboardShortcut] = [:]
		badDict[.commandPalette] = GlobalKeyboardShortcut(keyCode: 0, modifiers: 0, displayText: "")
		let data = try? JSONEncoder().encode(badDict)
		if let data, let value = String(data: data, encoding: .utf8) {
			suite.set(value, forKey: AppearancePreferences.globalShortcutsDefaultsKey)
		}
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		// A shortcut with no modifiers should be filtered out.
		#expect(prefs.shortcut(for: .commandPalette) == nil)
		#expect(prefs.globalShortcuts.isEmpty)
	}

	@Test("multiple actions can be set simultaneously")
	func multipleActionsSetSimultaneously() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let paletteShortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_K), modifiers: UInt32(cmdKey), displayText: "⌘K"
		)
		let recordingShortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_R), modifiers: UInt32(cmdKey) | UInt32(shiftKey),
			displayText: "⌘⇧R"
		)
		let chatShortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_N), modifiers: UInt32(cmdKey) | UInt32(shiftKey),
			displayText: "⌘⇧N"
		)
		prefs.setShortcut(paletteShortcut, for: .commandPalette)
		prefs.setShortcut(recordingShortcut, for: .toggleRecording)
		prefs.setShortcut(chatShortcut, for: .newChat)

		#expect(prefs.shortcut(for: .commandPalette) == paletteShortcut)
		#expect(prefs.shortcut(for: .toggleRecording) == recordingShortcut)
		#expect(prefs.shortcut(for: .newChat) == chatShortcut)
		#expect(prefs.globalShortcuts.count == 3)

		let reloaded = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(reloaded.shortcut(for: .commandPalette) == paletteShortcut)
		#expect(reloaded.shortcut(for: .toggleRecording) == recordingShortcut)
		#expect(reloaded.shortcut(for: .newChat) == chatShortcut)
	}

	@Test("hasRequiredModifiers reflects modifier state")
	func hasRequiredModifiers() {
		let withMods = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_K),
			modifiers: UInt32(cmdKey) | UInt32(shiftKey),
			displayText: "⌘⇧K"
		)
		#expect(withMods.hasRequiredModifiers)

		let noMods = GlobalKeyboardShortcut(keyCode: 0, modifiers: 0, displayText: "")
		#expect(!noMods.hasRequiredModifiers)
	}

	@Test("persistedValue round-trips through from(persistedValue:)")
	func roundTripPersistence() {
		let original = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_Space),
			modifiers: UInt32(cmdKey) | UInt32(optionKey),
			displayText: "⌘⌥Space"
		)
		let encoded = original.persistedValue
		#expect(encoded != nil)
		let decoded = GlobalKeyboardShortcut.from(persistedValue: encoded)
		#expect(decoded == original)
	}

	@Test("from(persistedValue:) returns nil for invalid input")
	func fromPersistedValueHandlesInvalidInput() {
		#expect(GlobalKeyboardShortcut.from(persistedValue: nil) == nil)
		#expect(GlobalKeyboardShortcut.from(persistedValue: "") == nil)
		#expect(GlobalKeyboardShortcut.from(persistedValue: "not json") == nil)
	}

	@Test("carbon modifier flags map from NSEvent flags")
	func carbonModifierMapping() {
		let flags: NSEvent.ModifierFlags = [.command, .shift]
		let carbon = KeyboardShortcutFormatter.carbonModifierFlags(from: flags)
		#expect(carbon == UInt32(cmdKey) | UInt32(shiftKey))
	}

	@Test("display string includes modifier glyphs and key")
	func displayStringIncludesModifiers() {
		let display = KeyboardShortcutFormatter.displayString(
			keyCode: UInt32(kVK_ANSI_K),
			modifiers: [.command, .shift]
		)
		#expect(display.contains("⌘"))
		#expect(display.contains("⇧"))
		#expect(display.contains("K"))
	}

	@Test("GlobalHotkeyAction has correct notifications and IDs")
	func actionNotificationsAndIds() {
		#expect(GlobalHotkeyAction.commandPalette.notificationName == .openCommandPalette)
		#expect(GlobalHotkeyAction.toggleRecording.notificationName == .menuBarToggleRecording)
		#expect(GlobalHotkeyAction.newChat.notificationName == .startNewChat)

		#expect(GlobalHotkeyAction.commandPalette.hotkeyId == 1)
		#expect(GlobalHotkeyAction.toggleRecording.hotkeyId == 2)
		#expect(GlobalHotkeyAction.newChat.hotkeyId == 3)

		// All IDs are unique.
		let ids = GlobalHotkeyAction.allCases.map(\.hotkeyId)
		#expect(Set(ids).count == ids.count)

		// All display names are non-empty.
		for action in GlobalHotkeyAction.allCases {
			#expect(!action.displayName.isEmpty)
			#expect(!action.description.isEmpty)
		}
	}

	@Test("General settings shows all three shortcut recorders")
	func generalSettingsShowsAllRecorders() throws {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let view = AppearanceSettingsView(preferences: prefs)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Command palette shortcut")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Start/stop recording shortcut")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "New chat shortcut")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Record…")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(
				viewWithAccessibilityIdentifier: "general-shortcut-command-palette"
			)
		}
		#expect(throws: Never.self) {
			try view.inspect().find(
				viewWithAccessibilityIdentifier: "general-shortcut-toggle-recording"
			)
		}
		#expect(throws: Never.self) {
			try view.inspect().find(
				viewWithAccessibilityIdentifier: "general-shortcut-new-chat"
			)
		}
	}

	@Test("General settings shows Clear button when a shortcut is set")
	func generalSettingsShowsClearWhenShortcutSet() throws {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		prefs.setShortcut(
			GlobalKeyboardShortcut(
				keyCode: UInt32(kVK_ANSI_K),
				modifiers: UInt32(cmdKey),
				displayText: "⌘K"
			),
			for: .commandPalette
		)
		let view = AppearanceSettingsView(preferences: prefs)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "⌘K")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Clear")
		}
	}
}
