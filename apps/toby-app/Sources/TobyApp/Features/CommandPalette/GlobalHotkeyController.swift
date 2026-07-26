import Carbon.HIToolbox
import Foundation

/// Registers a system-wide keyboard shortcut via Carbon's `RegisterEventHotKey`
/// and posts `Notification.Name.openCommandPalette` when the user presses it
/// anywhere on the system — even while another app is frontmost.
///
/// `@MainActor` because all interaction with `AppearancePreferences` and the
/// posted notification happens on the main thread. Carbon event handlers run
/// on the main run loop by default.
@MainActor
final class GlobalHotkeyController {
	static let shared = GlobalHotkeyController()

	private var hotkeyRef: EventHotKeyRef?
	private var eventHandler: EventHandlerRef?
	private var observer: NSObjectProtocol?
	private var currentShortcut: GlobalKeyboardShortcut?

	private init() {}

	/// Begins observing preference changes and registers the current shortcut.
	func start(prefs: AppearancePreferences) {
		guard observer == nil else { return }
		register(prefs.commandPaletteShortcut)
		observer = NotificationCenter.default.addObserver(
			forName: AppearancePreferences.commandPaletteShortcutDidChange,
			object: nil,
			queue: .main
		) { [weak self] _ in
			Task { @MainActor in
				self?.register(prefs.commandPaletteShortcut)
			}
		}
	}

	/// Removes any active hotkey registration and stops observing changes.
	func stop() {
		unregister()
		if let observer {
			NotificationCenter.default.removeObserver(observer)
			self.observer = nil
		}
	}

	/// Updates the registered hotkey. Unregisters the previous one first.
	func register(_ shortcut: GlobalKeyboardShortcut?) {
		unregister()
		currentShortcut = shortcut
		guard let shortcut, shortcut.hasRequiredModifiers else { return }
		installEventHandlerIfNeeded()

		let id = EventHotKeyID(signature: OSType(0x544f4259), id: 1) // 'TOBY'
		let status = RegisterEventHotKey(
			shortcut.keyCode,
			shortcut.modifiers,
			id,
			GetApplicationEventTarget(),
			0,
			&hotkeyRef
		)
		if status != noErr {
			hotkeyRef = nil
		}
	}

	private func unregister() {
		if let hotkeyRef {
			UnregisterEventHotKey(hotkeyRef)
			self.hotkeyRef = nil
		}
		currentShortcut = nil
	}

	/// Installs the one-shot Carbon event handler that dispatches the
	/// `openCommandPalette` notification. Idempotent.
	private func installEventHandlerIfNeeded() {
		guard eventHandler == nil else { return }

		var eventSpec = EventTypeSpec(
			eventClass: OSType(kEventClassKeyboard),
			eventKind: UInt32(kEventHotKeyPressed)
		)
		let selfPtr = Unmanaged.passUnretained(self).toOpaque()

		InstallEventHandler(
			GetApplicationEventTarget(),
			{ _, event, userData in
				guard let userData else { return noErr }
				let controller = Unmanaged<GlobalHotkeyController>.fromOpaque(userData).takeUnretainedValue()
				Task { @MainActor in
					controller.handleHotkeyPressed()
				}
				return noErr
			},
			1,
			&eventSpec,
			selfPtr,
			&eventHandler
		)
	}

	private func handleHotkeyPressed() {
		NotificationCenter.default.post(name: .openCommandPalette, object: nil)
	}
}
