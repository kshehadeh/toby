import Carbon.HIToolbox
import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Flow manual shortcuts")
struct FlowShortcutTests {
	private let shortcut = GlobalKeyboardShortcut(keyCode: 40, modifiers: 0x1900, displayText: "⌃⌥⌘K")

	private func flow(id: String = "flow.test", triggers: [FlowTriggerSpec]? = nil) -> FlowListItem {
		var trigger = FlowTriggerSpec.manual()
		trigger.id = "shortcut-trigger"
		trigger.source.shortcut = shortcut
		var flow = FlowListItem(
			id: id, name: id, description: nil, icon: nil, color: nil, builtin: false,
			persona: nil, nodes: [], result: nil, destinations: nil, createdAt: nil, updatedAt: nil
		)
		flow.triggers = triggers ?? [trigger]
		return flow
	}

	@Test("shortcut persists through trigger and editor document round trips")
	func roundTrip() throws {
		let trigger = try #require(flow().triggers?.first)
		let data = try JSONSerialization.data(withJSONObject: trigger.jsonBody)
		#expect(try JSONDecoder().decode(FlowTriggerSpec.self, from: data) == trigger)
		var draft = FlowEditorDraft.blank()
		draft.triggers = [trigger]
		draft.nodes = [.llm()]
		var body = draft.jsonBody()
		body["id"] = "flow.test"
		let document = try JSONDecoder().decode(FlowDocumentPayload.self, from: JSONSerialization.data(withJSONObject: body))
		#expect(FlowEditorDraft.from(document: document).triggers.first?.source.shortcut == shortcut)
		var changed = trigger
		changed.changeSource("schedule")
		#expect(changed.source.shortcut == nil)
		changed.changeSource("manual")
		#expect(changed.source.shortcut == nil)
		#expect(FlowTriggerSpec.manual().source.shortcut == nil)
	}

	@Test("only enabled custom manual triggers become bindings, independent of selection")
	func eligibleBindings() throws {
		var trigger = try #require(flow().triggers?.first)
		var disabled = trigger
		disabled.id = "disabled"
		disabled.enabled = false
		var automatic = trigger
		automatic.id = "automatic"
		automatic.source.type = "schedule"
		var unset = trigger
		unset.id = "unset"
		unset.source.shortcut = nil
		// Built-in status comes from the API rather than editor state.
		let builtinJSON = """
		{"id":"builtin","name":"Built in","builtin":true,"nodes":[],"triggers":[]}
		"""
		var builtin = try JSONDecoder().decode(FlowListItem.self, from: Data(builtinJSON.utf8))
		builtin.triggers = [trigger]
		let bindings = FlowShortcutBinding.bindings(in: [builtin, flow(triggers: [disabled, automatic, unset, trigger])])
		#expect(bindings.count == 1)
		#expect(bindings.first?.flowId == "flow.test")
		#expect(bindings.first?.triggerId == "shortcut-trigger")
		trigger.source.shortcut?.modifiers = 0
		#expect(FlowShortcutBinding.bindings(in: [flow(triggers: [trigger])]).isEmpty)
	}

	@Test("conflicts compare key combinations, not display text")
	func conflicts() throws {
		let first = try #require(FlowShortcutBinding.bindings(in: [flow()]).first)
		var differentlyLabelled = shortcut
		differentlyLabelled.displayText = "Other label"
		let second = FlowShortcutBinding(flowId: "flow.other", triggerId: "manual", flowName: "Other flow", shortcut: differentlyLabelled)
		#expect(first.conflictMessage(appShortcuts: [:], bindings: [first]) == nil)
		#expect(first.conflictMessage(appShortcuts: [.newChat: differentlyLabelled], bindings: [first])?.contains("New chat") == true)
		#expect(first.conflictMessage(appShortcuts: [:], bindings: [first, second])?.contains("Other flow") == true)
		#expect(second.conflictMessage(appShortcuts: [:], bindings: [first, second]) != nil)
	}

	@Test("recorder clears only the bound draft and manual cards expose it")
	func recorder() throws {
		var draftShortcut: GlobalKeyboardShortcut? = shortcut
		let recorder = KeyboardShortcutRecorder(shortcut: Binding(get: { draftShortcut }, set: { draftShortcut = $0 }))
		try recorder.inspect().find(button: "Clear").tap()
		#expect(draftShortcut == nil)
		#expect(flow().triggers?.first?.source.shortcut == shortcut)
		let trigger = try #require(flow().triggers?.first)
		for scheme in [ColorScheme.light, .dark] {
			let view = FlowTriggerCard(trigger: .constant(trigger), invalidFields: .constant([]), onRemove: {})
				.environment(\.colorScheme, scheme)
			_ = try view.inspect().find(KeyboardShortcutRecorder.self)
		}
		var automatic = trigger
		automatic.changeSource("schedule")
		let view = FlowTriggerCard(trigger: .constant(automatic), invalidFields: .constant([]), onRemove: {})
		#expect(throws: (any Error).self) {
			try view.inspect().find(KeyboardShortcutRecorder.self)
		}
	}

	@Test("controller reconciles changes, suspension, conflicts, removal and OS failures")
	func registrationLifecycle() throws {
		var registrations: [UInt32] = []
		var removals: [EventHotKeyRef] = []
		let controller = GlobalHotkeyController(register: { _, id in
			registrations.append(id)
			return OpaquePointer(bitPattern: Int(id))
		}, unregister: { removals.append($0) })
		defer { controller.stop() }
		controller.updateFlows([flow()])
		#expect(registrations.count == 1)
		controller.updateFlows([flow()])
		#expect(registrations.count == 1)
		controller.suspend()
		#expect(removals.count == 1)
		controller.suspend()
		controller.resume()
		#expect(registrations.count == 1)
		controller.resume()
		#expect(registrations.count == 2)
		#expect(registrations[0] != registrations[1])

		controller.updateFlows([flow(), flow(id: "flow.other")])
		#expect(controller.flowRegistrationErrors.count == 2)
		#expect(registrations.count == 2)
		controller.updateFlows([flow()])
		#expect(controller.flowRegistrationErrors.isEmpty)
		controller.registerAll([.newChat: shortcut])
		#expect(controller.flowRegistrationErrors.count == 1)
		controller.registerAll([:])
		#expect(controller.flowRegistrationErrors.isEmpty)
		var disabled = try #require(flow().triggers?.first)
		disabled.enabled = false
		let before = registrations.count
		controller.updateFlows([flow(triggers: [disabled])])
		#expect(registrations.count == before)
		controller.updateFlows([])
		#expect(controller.flowRegistrationErrors.isEmpty)

		let unavailable = GlobalHotkeyController(register: { _, _ in nil }, unregister: { _ in })
		defer { unavailable.stop() }
		unavailable.updateFlows([flow()])
		#expect(unavailable.flowRegistrationErrors["flow.test/shortcut-trigger"]?.contains("unavailable") == true)
	}

	@Test("activation dispatches exact saved trigger and ignores stale IDs and capture mode")
	func dispatch() throws {
		var registeredId: UInt32 = 0
		let controller = GlobalHotkeyController(register: { _, id in
			registeredId = id
			return OpaquePointer(bitPattern: Int(id))
		}, unregister: { _ in })
		defer { controller.stop() }
		final class Received: @unchecked Sendable {
			var bindings: [FlowShortcutBinding] = []
		}
		let received = Received()
		let observer = NotificationCenter.default.addObserver(forName: .runFlowShortcut, object: nil, queue: .main) {
			if let binding = $0.object as? FlowShortcutBinding { received.bindings.append(binding) }
		}
		defer { NotificationCenter.default.removeObserver(observer) }
		controller.updateFlows([flow()])
		let oldId = registeredId
		controller.handleHotkeyPressed(id: oldId)
		#expect(received.bindings.first?.triggerId == "shortcut-trigger")
		#expect(received.bindings.first?.flowId == "flow.test")
		controller.suspend()
		controller.handleHotkeyPressed(id: oldId)
		controller.resume()
		controller.handleHotkeyPressed(id: oldId)
		#expect(received.bindings.count == 1)
		controller.handleHotkeyPressed(id: registeredId)
		#expect(received.bindings.count == 2)
		controller.updateFlows([])
		controller.handleHotkeyPressed(id: registeredId)
		#expect(received.bindings.count == 2)
	}
}
