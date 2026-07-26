import Carbon.HIToolbox
import Foundation

/// Registers system-wide keyboard shortcuts via Carbon's
/// `RegisterEventHotKey` and posts the appropriate notification when the user
/// presses one anywhere on the system — even while another app is frontmost.
///
/// `@MainActor` because all interaction with `AppearancePreferences` and the
/// posted notification happens on the main thread. Carbon event handlers run
/// on the main run loop by default.
@MainActor
final class GlobalHotkeyController {
	static let shared = GlobalHotkeyController()

	/// Maps Carbon hotkey ID → action for dispatch.
	private var registeredActions: [UInt32: GlobalHotkeyAction] = [:]
	/// Maps Carbon hotkey ID → ref for unregistration.
	private var hotkeyRefs: [UInt32: EventHotKeyRef] = [:]
	private var eventHandler: EventHandlerRef?
	private var observer: NSObjectProtocol?

	private init() {}

	/// Begins observing preference changes and registers all current shortcuts.
	func start(prefs: AppearancePreferences) {
		guard observer == nil else { return }
		registerAll(prefs.globalShortcuts)
		observer = NotificationCenter.default.addObserver(
			forName: AppearancePreferences.globalShortcutsDidChange,
			object: nil,
			queue: .main
		) { [weak self] _ in
			Task { @MainActor in
				self?.registerAll(prefs.globalShortcuts)
			}
		}
	}

	/// Removes any active hotkey registrations and stops observing changes.
	func stop() {
		unregisterAll()
		if let observer {
			NotificationCenter.default.removeObserver(observer)
			self.observer = nil
		}
	}

	/// Re-registers all hotkeys from the given dictionary.
	func registerAll(_ shortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut]) {
		unregisterAll()
		guard !shortcuts.isEmpty else { return }
		installEventHandlerIfNeeded()

		for (action, shortcut) in shortcuts {
			guard shortcut.hasRequiredModifiers else { continue }
			let hotkeyId = action.hotkeyId
			var ref: EventHotKeyRef?
			let id = EventHotKeyID(signature: OSType(0x544f4259), id: hotkeyId) // 'TOBY'
			let status = RegisterEventHotKey(
				shortcut.keyCode,
				shortcut.modifiers,
				id,
				GetApplicationEventTarget(),
				0,
				&ref
			)
			if status == noErr, let ref {
				hotkeyRefs[hotkeyId] = ref
				registeredActions[hotkeyId] = action
			}
		}
	}

	private func unregisterAll() {
		for (_, ref) in hotkeyRefs {
			UnregisterEventHotKey(ref)
		}
		hotkeyRefs.removeAll()
		registeredActions.removeAll()
	}

	/// Installs the one-shot Carbon event handler that dispatches notifications.
	/// Idempotent.
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

				// Extract the hotkey ID from the event.
				var hotkeyId = EventHotKeyID()
				let result = GetEventParameter(
					event,
					EventParamName(kEventParamDirectObject),
					EventParamType(typeEventHotKeyID),
					nil,
					MemoryLayout<EventHotKeyID>.size,
					nil,
					&hotkeyId
				)
				guard result == noErr else { return noErr }

				Task { @MainActor in
					controller.handleHotkeyPressed(id: hotkeyId.id)
				}
				return noErr
			},
			1,
			&eventSpec,
			selfPtr,
			&eventHandler
		)
	}

	private func handleHotkeyPressed(id: UInt32) {
		guard let action = registeredActions[id] else { return }
		NotificationCenter.default.post(name: action.notificationName, object: nil)
	}
}
