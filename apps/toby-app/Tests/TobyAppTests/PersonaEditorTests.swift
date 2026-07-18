import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("PersonaEditor")
struct PersonaEditorTests {
	@Test("create mode store starts with empty fields")
	func createModeStoreDefaults() throws {
		let store = PersonaEditorStore(mode: .create)
		#expect(store.name == "")
		#expect(store.instructions == "")
		#expect(store.mode.isCreate)
		#expect(!store.mode.isEdit)
	}

	@Test("edit mode store has correct mode")
	func editModeStore() throws {
		let store = PersonaEditorStore(mode: .edit(name: "MyPersona"))
		#expect(store.mode.isEdit)
		#expect(!store.mode.isCreate)
	}

	@Test("canSave is false for empty name")
	func canSaveEmptyName() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = ""
		#expect(!store.canSave)
	}

	@Test("canSave is false for whitespace-only name")
	func canSaveWhitespaceName() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "   "
		#expect(!store.canSave)
	}

	@Test("canSave is true for valid name when not loading")
	func canSaveValidName() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "My Persona"
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: true),
		]
		store.provider = "openai"
		#expect(store.canSave)
	}

	@Test("canSave is false while saving")
	func canSaveWhileSaving() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "My Persona"
		store.saveState = .saving
		#expect(!store.canSave)
	}

	@Test("availableModels includes current model even if not in provider list")
	func availableModelsIncludesCurrentModel() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.provider = "openai"
		store.model = "custom-model"
		let models = store.availableModels
		#expect(models.map(\.id).contains("gpt-5"))
		#expect(models.map(\.id).contains("custom-model"))
	}

	@Test("availableModels returns provider models")
	func availableModelsFromProvider() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5", "gpt-5-mini"], allowCustomModel: false),
		]
		store.provider = "openai"
		store.model = "gpt-5"
		let models = store.availableModels
		#expect(models.map(\.id).contains("gpt-5"))
		#expect(models.map(\.id).contains("gpt-5-mini"))
	}

	@Test("reasoning models get a picker label suffix")
	func reasoningModelPickerLabel() throws {
		let reasoning = AIModelOption(id: "openai/gpt-5-nano", reasoning: true)
		let plain = AIModelOption(id: "openai/gpt-4.1-mini")
		#expect(reasoning.pickerLabel == "openai/gpt-5-nano · reasoning")
		#expect(plain.pickerLabel == "openai/gpt-4.1-mini")
	}

	@Test("editor view renders name field in create mode")
	func editorViewRendersNameField() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "Test"
		store.instructions = "Be helpful"
		let view = PersonaEditorView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "New Persona") }
	}

	@Test("editor view renders edit title in edit mode")
	func editorViewRendersEditTitle() throws {
		let store = PersonaEditorStore(mode: .edit(name: "MyPersona"))
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.name = "MyPersona"
		store.instructions = "Be helpful"
		let view = PersonaEditorView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "Edit Persona") }
	}

	@Test("editor view renders provider and model labels")
	func editorViewRendersProviderModel() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false),
		]
		store.provider = "openai"
		store.model = "gpt-5"
		store.name = "Test"
		store.instructions = "Be helpful"
		let view = PersonaEditorView(store: store, onSaved: {}, onCancel: {})
		#expect(throws: Never.self) { try view.inspect().find(text: "Provider") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Model") }
	}

	@Test("coordinator store is nil by default")
	func coordinatorDefaultsToNil() throws {
		let coordinator = PersonaEditorCoordinator()
		#expect(coordinator.store == nil)
	}

	@Test("isNameEditable is true in create mode")
	func isNameEditableInCreateMode() throws {
		let store = PersonaEditorStore(mode: .create)
		#expect(store.isNameEditable)
	}

	@Test("isNameEditable is false for built-in persona in edit mode")
	func isNameEditableForBuiltIn() throws {
		let store = PersonaEditorStore(mode: .edit(name: "Toby"))
		store.isBuiltIn = true
		#expect(!store.isNameEditable)
	}

	@Test("built-in persona only allows provider and model fields")
	func builtInPersonaEditability() throws {
		let store = PersonaEditorStore(mode: .edit(name: "Toby"))
		store.isBuiltIn = true
		#expect(!store.isNameEditable)
		#expect(!store.canEditPersonaDefinition)
		#expect(!store.canEditImage)
	}

	@Test("isNameEditable is true for custom persona in edit mode")
	func isNameEditableForCustom() throws {
		let store = PersonaEditorStore(mode: .edit(name: "MyPersona"))
		store.isBuiltIn = false
		#expect(store.isNameEditable)
		#expect(store.canEditPersonaDefinition)
		#expect(store.canEditImage)
	}

	@Test("hasCustomImage is false when imagePath is nil or empty")
	func hasCustomImageDefaults() throws {
		let store = PersonaEditorStore(mode: .create)
		#expect(!store.hasCustomImage)
		store.imagePath = ""
		#expect(!store.hasCustomImage)
		store.imagePath = "my-image.png"
		#expect(store.hasCustomImage)
	}

	// MARK: - AI provider configuration validation

	@Test("hasConfiguredProviders is false when no providers are configured")
	func hasConfiguredProvidersNone() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
			AIProviderInfo(providerId: "vercel", displayName: "Vercel AI Gateway", models: ["openai/gpt-5"], allowCustomModel: true, configured: false),
		]
		#expect(!store.hasConfiguredProviders)
	}

	@Test("hasConfiguredProviders is true when at least one provider is configured")
	func hasConfiguredProvidersSome() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
			AIProviderInfo(providerId: "vercel", displayName: "Vercel AI Gateway", models: ["openai/gpt-5"], allowCustomModel: true, configured: true),
		]
		#expect(store.hasConfiguredProviders)
	}

	@Test("isSelectedProviderConfigured is false when selected provider is not configured")
	func isSelectedProviderConfiguredFalse() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
			AIProviderInfo(providerId: "vercel", displayName: "Vercel AI Gateway", models: ["openai/gpt-5"], allowCustomModel: true, configured: true),
		]
		store.provider = "openai"
		#expect(!store.isSelectedProviderConfigured)
	}

	@Test("isSelectedProviderConfigured is true when selected provider is configured")
	func isSelectedProviderConfiguredTrue() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: true),
		]
		store.provider = "openai"
		#expect(store.isSelectedProviderConfigured)
	}

	@Test("canSave is false when no providers are configured")
	func canSaveNoConfiguredProviders() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "My Persona"
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
		]
		store.provider = "openai"
		#expect(!store.canSave)
	}

	@Test("canSave is false when selected provider is not configured")
	func canSaveUnconfiguredSelectedProvider() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "My Persona"
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
			AIProviderInfo(providerId: "vercel", displayName: "Vercel AI Gateway", models: ["openai/gpt-5"], allowCustomModel: true, configured: true),
		]
		store.provider = "openai"
		#expect(!store.canSave)
	}

	@Test("canSave is true when selected provider is configured")
	func canSaveConfiguredSelectedProvider() throws {
		let store = PersonaEditorStore(mode: .create)
		store.name = "My Persona"
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: true),
		]
		store.provider = "openai"
		#expect(store.canSave)
	}

	@Test("providerValidationMessage is non-nil when no providers are configured")
	func providerValidationMessageNoneConfigured() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
		]
		store.provider = "openai"
		let message = store.providerValidationMessage
		#expect(message != nil)
		#expect(message?.contains("No AI provider") == true)
	}

	@Test("providerValidationMessage is non-nil when selected provider is not configured")
	func providerValidationMessageUnconfiguredSelected() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: false),
			AIProviderInfo(providerId: "vercel", displayName: "Vercel AI Gateway", models: ["openai/gpt-5"], allowCustomModel: true, configured: true),
		]
		store.provider = "openai"
		let message = store.providerValidationMessage
		#expect(message != nil)
		#expect(message?.contains("not configured") == true)
	}

	@Test("providerValidationMessage is nil when selected provider is configured")
	func providerValidationMessageConfigured() throws {
		let store = PersonaEditorStore(mode: .create)
		store.providers = [
			AIProviderInfo(providerId: "openai", displayName: "OpenAI", models: ["gpt-5"], allowCustomModel: false, configured: true),
		]
		store.provider = "openai"
		#expect(store.providerValidationMessage == nil)
	}
}
