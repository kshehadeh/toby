import Carbon.HIToolbox
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("GlobalKeyboardShortcut")
struct GlobalKeyboardShortcutTests {
	@Test("defaults to nil when unset")
	func defaultsToNilWhenUnset() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(prefs.commandPaletteShortcut == nil)
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
		prefs.commandPaletteShortcut = shortcut
		#expect(prefs.commandPaletteShortcut == shortcut)

		let reloaded = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(reloaded.commandPaletteShortcut == shortcut)
		#expect(reloaded.commandPaletteShortcut?.displayText == "⌘K")
	}

	@Test("clearing a shortcut removes it from UserDefaults")
	func clearingRemovesShortcut() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		prefs.commandPaletteShortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_K),
			modifiers: UInt32(cmdKey),
			displayText: "⌘K"
		)
		#expect(prefs.commandPaletteShortcut != nil)
		prefs.commandPaletteShortcut = nil
		#expect(prefs.commandPaletteShortcut == nil)

		let reloaded = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(reloaded.commandPaletteShortcut == nil)
	}

	@Test("shortcuts without modifiers are rejected on init")
	func shortcutsWithoutModifiersAreRejected() {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		suite.set(
			GlobalKeyboardShortcut(keyCode: 0, modifiers: 0, displayText: "").persistedValue,
			forKey: AppearancePreferences.commandPaletteShortcutDefaultsKey
		)
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		// A shortcut with no modifiers should resolve to nil.
		#expect(prefs.commandPaletteShortcut == nil)
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

	@Test("General settings shows command palette shortcut recorder")
	func generalSettingsShowsShortcutRecorder() throws {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let view = AppearanceSettingsView(preferences: prefs)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Command palette shortcut")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Record…")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(
				viewWithAccessibilityIdentifier: "general-command-palette-shortcut-recorder"
			)
		}
	}

	@Test("General settings shows Clear button when shortcut is set")
	func generalSettingsShowsClearWhenShortcutSet() throws {
		let suite = UserDefaults(suiteName: "toby.tests.shortcut.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		prefs.commandPaletteShortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(kVK_ANSI_K),
			modifiers: UInt32(cmdKey),
			displayText: "⌘K"
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
