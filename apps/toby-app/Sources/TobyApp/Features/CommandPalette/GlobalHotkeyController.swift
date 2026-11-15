import Carbon.HIToolbox
import Foundation
import Observation

/// Registers system-wide keyboard shortcuts via Carbon's
/// `RegisterEventHotKey` and posts the appropriate notification when the user
/// presses one anywhere on the system — even while another app is frontmost.
///
/// `@MainActor` because all interaction with `AppearancePreferences` and the
/// posted notification happens on the main thread. Carbon event handlers run
/// on the main run loop by default.
@MainActor
@Observable
final class GlobalHotkeyController {
	static let shared = GlobalHotkeyController()

	/// Maps Carbon hotkey ID → action for dispatch.
	private var registeredActions: [UInt32: GlobalHotkeyAction] = [:]
	private var registeredFlows: [UInt32: FlowShortcutBinding] = [:]
	private var appShortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut] = [:]
	private var flowBindings: [FlowShortcutBinding] = []
	private var suspensionCount = 0
	private var nextFlowHotkeyId: UInt32 = 100
	private(set) var flowRegistrationErrors: [String: String] = [:]
	/// Maps Carbon hotkey ID → ref for unregistration.
	private var hotkeyRefs: [UInt32: EventHotKeyRef] = [:]
	private var eventHandler: EventHandlerRef?
	private var observer: NSObjectProtocol?
	private let register: (GlobalKeyboardShortcut, UInt32) -> EventHotKeyRef?
	private let unregister: (EventHotKeyRef) -> Void

	init(
		register: @escaping (GlobalKeyboardShortcut, UInt32) -> EventHotKeyRef? = { shortcut, hotkeyId in
			var ref: EventHotKeyRef?
			let status = RegisterEventHotKey(
				shortcut.keyCode, shortcut.modifiers,
				EventHotKeyID(signature: OSType(0x544f4259), id: hotkeyId),
				GetApplicationEventTarget(), 0, &ref
			)
			return status == noErr ? ref : nil
		},
		unregister: @escaping (EventHotKeyRef) -> Void = { UnregisterEventHotKey($0) }
	) {
		self.register = register
		self.unregister = unregister
	}

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
		flowBindings = []
		appShortcuts = [:]
		flowRegistrationErrors = [:]
		if let eventHandler {
			RemoveEventHandler(eventHandler)
			self.eventHandler = nil
		}
		if let observer {
			NotificationCenter.default.removeObserver(observer)
			self.observer = nil
		}
	}

	/// Re-registers all hotkeys from the given dictionary.
	func registerAll(_ shortcuts: [GlobalHotkeyAction: GlobalKeyboardShortcut]) {
		appShortcuts = shortcuts
		rebuildRegistrations()
	}

	func updateFlows(_ flows: [FlowListItem]) {
		let bindings = FlowShortcutBinding.bindings(in: flows)
		guard bindings != flowBindings else { return }
		flowBindings = bindings
		rebuildRegistrations()
	}

	/// Temporarily release Carbon registrations so recording an existing
	/// combination cannot execute an action or steal the captured key event.
	func suspend() {
		suspensionCount += 1
		unregisterAll()
	}

	func resume() {
		suspensionCount = max(0, suspensionCount - 1)
		if suspensionCount == 0 { rebuildRegistrations() }
	}

	private func rebuildRegistrations() {
		unregisterAll()
		guard suspensionCount == 0 else { return }
		flowRegistrationErrors = [:]
		guard !appShortcuts.isEmpty || !flowBindings.isEmpty else { return }
		installEventHandlerIfNeeded()

		for action in GlobalHotkeyAction.allCases {
			guard let shortcut = appShortcuts[action] else { continue }
			guard shortcut.hasRequiredModifiers else { continue }
			let hotkeyId = action.hotkeyId
			if let ref = register(shortcut, hotkeyId) {
				hotkeyRefs[hotkeyId] = ref
				registeredActions[hotkeyId] = action
			}
		}
		for binding in flowBindings {
			if let conflict = binding.conflictMessage(appShortcuts: appShortcuts, bindings: flowBindings) {
				flowRegistrationErrors[binding.id] = conflict
				continue
			}
			let hotkeyId = nextFlowHotkeyId
			nextFlowHotkeyId += 1
			if let ref = register(binding.shortcut, hotkeyId) {
				hotkeyRefs[hotkeyId] = ref
				registeredFlows[hotkeyId] = binding
			} else {
				flowRegistrationErrors[binding.id] = "This shortcut is unavailable, possibly because another app uses it. Record another combination."
			}
		}
	}

	private func unregisterAll() {
		for (_, ref) in hotkeyRefs {
			unregister(ref)
		}
		hotkeyRefs.removeAll()
		registeredActions.removeAll()
		registeredFlows.removeAll()
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

	func handleHotkeyPressed(id: UInt32) {
		guard suspensionCount == 0 else { return }
		if let binding = registeredFlows[id] {
			NotificationCenter.default.post(name: .runFlowShortcut, object: binding)
			return
		}
		guard let action = registeredActions[id] else { return }
		NotificationCenter.default.post(name: action.notificationName, object: nil)
	}
}
