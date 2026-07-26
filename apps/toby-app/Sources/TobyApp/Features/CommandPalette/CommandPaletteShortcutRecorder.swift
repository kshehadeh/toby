import AppKit
import Carbon.HIToolbox
import SwiftUI

/// A Settings control that lets the user record a system-wide keyboard
/// shortcut for the command palette.
///
/// Click "Record…" to enter capture mode, press a key with at least one
/// modifier, and the shortcut is saved. Press Escape to cancel recording.
/// "Clear" removes the shortcut.
struct CommandPaletteShortcutRecorder: View {
	@Bindable var preferences: AppearancePreferences
	@State private var isRecording = false

	var body: some View {
		HStack(spacing: 10) {
			if isRecording {
				Text("Press keys…")
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
					.padding(.horizontal, 10)
					.padding(.vertical, 5)
					.background(
						RoundedRectangle(cornerRadius: 6)
							.fill(AppTheme.selection.opacity(0.3))
					)
				Button("Cancel") { isRecording = false }
					.buttonStyle(.bordered)
			} else if let shortcut = preferences.commandPaletteShortcut {
				ShortcutBadge(text: shortcut.displayText)
				Button("Record…") { isRecording = true }
					.buttonStyle(.bordered)
				Button("Clear") {
					preferences.commandPaletteShortcut = nil
				}
				.buttonStyle(.bordered)
			} else {
				Text("Not set")
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.tertiaryText)
				Button("Record…") { isRecording = true }
					.buttonStyle(.bordered)
			}
		}
		.overlay {
			if isRecording {
				ShortcutCaptureView { shortcut in
					preferences.commandPaletteShortcut = shortcut
					isRecording = false
				} onCancel: {
					isRecording = false
				}
			}
		}
	}
}

/// Displays a keyboard shortcut using macOS-style glyph text.
private struct ShortcutBadge: View {
	let text: String

	var body: some View {
		Text(text)
			.font(.system(size: 13, weight: .semibold))
			.foregroundStyle(AppTheme.primaryText)
			.padding(.horizontal, 10)
			.padding(.vertical, 5)
			.background(
				RoundedRectangle(cornerRadius: 6)
					.fill(AppTheme.panelBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: 6)
					.stroke(AppTheme.separator, lineWidth: 1)
			)
	}
}

/// Pure helpers for converting NSEvent key codes and modifier flags into
/// Carbon modifier flags and display strings. Extracted so they can be tested
/// without instantiating the capture view.
enum KeyboardShortcutFormatter {
	/// Maps NSEvent modifier flags to Carbon modifier flags.
	static func carbonModifierFlags(from flags: NSEvent.ModifierFlags) -> UInt32 {
		var carbon: UInt32 = 0
		if flags.contains(.command) { carbon |= UInt32(cmdKey) }
		if flags.contains(.shift) { carbon |= UInt32(shiftKey) }
		if flags.contains(.option) { carbon |= UInt32(optionKey) }
		if flags.contains(.control) { carbon |= UInt32(controlKey) }
		return carbon
	}

	/// Builds a human-readable shortcut string from the key code and modifiers.
	static func displayString(keyCode: UInt32, modifiers: NSEvent.ModifierFlags) -> String {
		var parts: [String] = []
		if modifiers.contains(.control) { parts.append("⌃") }
		if modifiers.contains(.option) { parts.append("⌥") }
		if modifiers.contains(.shift) { parts.append("⇧") }
		if modifiers.contains(.command) { parts.append("⌘") }
		parts.append(keyGlyph(for: keyCode))
		return parts.joined()
	}

	/// Returns a display glyph for the given Carbon key code.
	static func keyGlyph(for keyCode: UInt32) -> String {
		switch Int(keyCode) {
		case kVK_ANSI_A: "A"
		case kVK_ANSI_B: "B"
		case kVK_ANSI_C: "C"
		case kVK_ANSI_D: "D"
		case kVK_ANSI_E: "E"
		case kVK_ANSI_F: "F"
		case kVK_ANSI_G: "G"
		case kVK_ANSI_H: "H"
		case kVK_ANSI_I: "I"
		case kVK_ANSI_J: "J"
		case kVK_ANSI_K: "K"
		case kVK_ANSI_L: "L"
		case kVK_ANSI_M: "M"
		case kVK_ANSI_N: "N"
		case kVK_ANSI_O: "O"
		case kVK_ANSI_P: "P"
		case kVK_ANSI_Q: "Q"
		case kVK_ANSI_R: "R"
		case kVK_ANSI_S: "S"
		case kVK_ANSI_T: "T"
		case kVK_ANSI_U: "U"
		case kVK_ANSI_V: "V"
		case kVK_ANSI_W: "W"
		case kVK_ANSI_X: "X"
		case kVK_ANSI_Y: "Y"
		case kVK_ANSI_Z: "Z"
		case kVK_ANSI_0: "0"
		case kVK_ANSI_1: "1"
		case kVK_ANSI_2: "2"
		case kVK_ANSI_3: "3"
		case kVK_ANSI_4: "4"
		case kVK_ANSI_5: "5"
		case kVK_ANSI_6: "6"
		case kVK_ANSI_7: "7"
		case kVK_ANSI_8: "8"
		case kVK_ANSI_9: "9"
		case kVK_Space: "Space"
		case kVK_Return: "↩"
		case kVK_Tab: "⇥"
		case kVK_Delete: "⌫"
		case kVK_ForwardDelete: "⌦"
		case kVK_LeftArrow: "←"
		case kVK_RightArrow: "→"
		case kVK_UpArrow: "↑"
		case kVK_DownArrow: "↓"
		case kVK_Escape: "⎋"
		case kVK_F1: "F1"
		case kVK_F2: "F2"
		case kVK_F3: "F3"
		case kVK_F4: "F4"
		case kVK_F5: "F5"
		case kVK_F6: "F6"
		case kVK_F7: "F7"
		case kVK_F8: "F8"
		case kVK_F9: "F9"
		case kVK_F10: "F10"
		case kVK_F11: "F11"
		case kVK_F12: "F12"
		default: "Key\(keyCode)"
		}
	}
}

/// An invisible NSView that captures the first key-down event with modifiers
/// and reports it as a `GlobalKeyboardShortcut`, or cancels on Escape.
private struct ShortcutCaptureView: NSViewRepresentable {
	let onCapture: (GlobalKeyboardShortcut) -> Void
	let onCancel: () -> Void

	func makeNSView(context: Context) -> ShortcutCaptureNSView {
		let view = ShortcutCaptureNSView()
		view.onCapture = onCapture
		view.onCancel = onCancel
		DispatchQueue.main.async {
			view.beginCapture()
		}
		return view
	}

	func updateNSView(_ nsView: ShortcutCaptureNSView, context: Context) {}
}

private final class ShortcutCaptureNSView: NSView {
	var onCapture: ((GlobalKeyboardShortcut) -> Void)?
	var onCancel: (() -> Void)?
	private var monitor: Any?

	override var acceptsFirstResponder: Bool { true }

	func beginCapture() {
		// Local monitor so we capture key events within the app while recording.
		monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
			self?.handleKeyDown(event)
			return nil // consume the event
		}
	}

	private func handleKeyDown(_ event: NSEvent) {
		stop()

		// Escape cancels recording.
		if event.keyCode == kVK_Escape {
			onCancel?()
			return
		}

		let carbonModifiers = KeyboardShortcutFormatter.carbonModifierFlags(from: event.modifierFlags)
		// Require at least one modifier for a global hotkey.
		guard carbonModifiers != 0 else {
			onCancel?()
			return
		}

		let display = KeyboardShortcutFormatter.displayString(
			keyCode: UInt32(event.keyCode),
			modifiers: event.modifierFlags
		)
		let shortcut = GlobalKeyboardShortcut(
			keyCode: UInt32(event.keyCode),
			modifiers: carbonModifiers,
			displayText: display
		)
		onCapture?(shortcut)
	}

	private func stop() {
		if let monitor {
			NSEvent.removeMonitor(monitor)
			self.monitor = nil
		}
	}

	deinit {
		MainActor.assumeIsolated {
			if let monitor {
				NSEvent.removeMonitor(monitor)
			}
		}
	}
}
