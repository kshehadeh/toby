import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("PersonasSettings")
struct PersonasSettingsTests {
	// MARK: - SettingsItem.personasSection

	@Test("personas section has correct key and label")
	func personasSectionProperties() throws {
		let section = SettingsItem.personasSection
		#expect(section.key == SettingsItem.personasSectionKey)
		#expect(section.label == "Personas")
		#expect(section.kind == .section)
		#expect(section.navKey == SettingsItem.personasSectionKey)
	}

	@Test("personas section key is distinct from appearance key")
	func personasKeyIsDistinct() throws {
		#expect(SettingsItem.personasSectionKey != SettingsItem.appearanceSectionKey)
		#expect(SettingsItem.personasSectionKey == "personas")
	}

	// MARK: - PersonaEditorStore.delete

	@Test("delete is a no-op in create mode")
	func deleteNoOpInCreateMode() async throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "Test"
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: true),
		]
		await store.delete()
		// Delete should not change state in create mode.
		#expect(store.saveState != .saved)
	}

	@Test("delete is a no-op for built-in persona")
	func deleteNoOpForBuiltIn() async throws {
		let store = PersonaEditorStore(mode: .edit(name: "Toby"))
		store.isBuiltIn = true
		await store.delete()
		#expect(store.saveState != .saved)
	}

	// MARK: - PersonaEditorFormView

	@Test("form view renders create title")
	func formViewRendersCreateTitle() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "Test"
		store.instructions = "Be helpful"
		let view = PersonaEditorFormView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "New Persona") }
	}

	@Test("form view renders edit title")
	func formViewRendersEditTitle() throws {
		let store = PersonaEditorStore(mode: .edit(name: "MyPersona"))
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "MyPersona"
		store.instructions = "Be helpful"
		let view = PersonaEditorFormView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "Edit Persona") }
	}

	@Test("form view renders provider and model labels")
	func formViewRendersProviderModel() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.provider = "openai"
		store.model = "gpt-5"
		store.name = "Test"
		store.instructions = "Be helpful"
		let view = PersonaEditorFormView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "Provider") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Model") }
	}

	@Test("form view shows delete button when enabled")
	func formViewShowsDeleteButton() throws {
		let store = PersonaEditorStore(mode: .edit(name: "MyPersona"))
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "MyPersona"
		store.isBuiltIn = false
		store.instructions = "Be helpful"
		let view = PersonaEditorFormView(
			store: store,
			showDeleteButton: true,
			onDelete: {},
			onSaved: {},
			onCancel: {},
		)
		#expect(throws: Never.self) { try view.inspect().find(button: "Delete") }
	}

	@Test("form view hides delete button when disabled")
	func formViewHidesDeleteButton() throws {
		let store = PersonaEditorStore(mode: .edit(name: "MyPersona"))
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "MyPersona"
		store.isBuiltIn = false
		store.instructions = "Be helpful"
		let view = PersonaEditorFormView(
			store: store,
			showDeleteButton: false,
			onSaved: {},
			onCancel: {},
		)
		#expect(throws: Error.self) {
			try view.inspect().find(button: "Delete")
		}
	}

	// MARK: - PersonasSettingsView

	@Test("personas settings view can be instantiated")
	func personasSettingsViewInstantiation() throws {
		let configureStore = ConfigureStore()
		let view = PersonasSettingsView(store: configureStore)
		// Just verify it can be created without crashing.
		_ = view
	}

	// MARK: - ConfigureStore.pendingPersonaSelection

	@Test("configure store pendingPersonaSelection is nil by default")
	func pendingPersonaSelectionDefault() throws {
		let store = ConfigureStore()
		#expect(store.pendingPersonaSelection == nil)
	}

	@Test("configure store pendingPersonaSelection can be set and cleared")
	func pendingPersonaSelectionSetClear() throws {
		let store = ConfigureStore()
		store.pendingPersonaSelection = "MyPersona"
		#expect(store.pendingPersonaSelection == "MyPersona")
		store.pendingPersonaSelection = nil
		#expect(store.pendingPersonaSelection == nil)
	}

	// MARK: - PersonaEditorView (window wrapper still works)

	@Test("window editor view renders create title via form view")
	func windowEditorViewStillRenders() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "Test"
		store.instructions = "Be helpful"
		let view = PersonaEditorView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "New Persona") }
	}
}
