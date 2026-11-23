import Foundation
import TobyAI
import Observation

@Observable
@MainActor
final class PersonaEditorCoordinator {
	var store: PersonaEditorStore?
}

@Observable
@MainActor
final class PersonaEditorStore {
	enum Mode: Equatable {
		case create
		case edit(name: String)
	}

	enum SaveState: Equatable {
		case idle
		case saving
		case saved
		case error(String)
	}

	/// Snapshot of field values captured after `load()` so we can detect
	/// unsaved edits and power the "Reset" button.
	private struct Snapshot: Equatable {
		var name: String
		var instructions: String
		var model: String
		var promptMode: String
	}

	let mode: Mode
	let id = UUID()
	var name = ""
	var instructions = ""
	var model = ModelRole.chat.defaultModelId
	var promptMode = "add"
	var imagePath: String?
	var imageUrl: String?
	var isBuiltIn = false
	/// OpenRouter models from the live catalog (empty until signed in).
	var catalogModels: [AIModelOption] = []
	/// Whether an OpenRouter key is saved.
	var isSignedIn = false
	var isLoading = false
	var isSavingImage = false
	var saveState: SaveState = .idle
	var errorMessage: String?

	private var originalSnapshot: Snapshot?
	private let client = TobyClient()

	init(mode: Mode) {
		self.mode = mode
	}

	var isNameEditable: Bool {
		if mode.isCreate { return true }
		return !isBuiltIn
	}

	var canEditPersonaDefinition: Bool {
		!isBuiltIn
	}

	var canEditImage: Bool {
		mode.isEdit && !isBuiltIn
	}

	var hasCustomImage: Bool {
		guard let imagePath, !imagePath.isEmpty else { return false }
		return true
	}

	var displayImageURL: URL {
		if let imageUrl,
			let url = ConfigReader.assetURL(imageUrl)
		{
			return url
		}
		return ConfigReader.defaultPersonaImageURL
	}

	var availableModels: [AIModelOption] {
		var models = catalogModels
		if !model.isEmpty && !models.contains(where: { $0.id == model }) {
			models.insert(AIModelOption(id: model), at: 0)
		}
		return models
	}

	var signInMessage: String? {
		isSignedIn ? nil : "Sign in with OpenRouter in Settings → Account to choose a model."
	}

	var canSave: Bool {
		guard !isLoading, saveState != .saving else { return false }
		guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			return false
		}
		return isSignedIn
	}

	/// True when any editable field differs from its value at load time.
	var hasUnsavedChanges: Bool {
		guard let original = originalSnapshot else { return false }
		return name != original.name
			|| instructions != original.instructions
			|| model != original.model
			|| promptMode != original.promptMode
	}

	/// Restores all editable fields to their state when the persona was loaded.
	/// No-op until `load()` has captured a snapshot.
	func discardChanges() {
		guard let original = originalSnapshot else { return }
		name = original.name
		instructions = original.instructions
		model = original.model
		promptMode = original.promptMode
		errorMessage = nil
	}

	/// Captures the current field values as the clean baseline for
	/// dirty-tracking. Called automatically at the end of `load()` and after a
	/// successful `save()`. Exposed for test setup.
	func captureSnapshot() {
		originalSnapshot = Snapshot(
			name: name,
			instructions: instructions,
			model: model,
			promptMode: promptMode
		)
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			let openRouter = try await client.fetchAIProviders().first
			isSignedIn = openRouter?.configured == true
			catalogModels = (openRouter?.models ?? []).sorted { ($0.displayName ?? $0.id) < ($1.displayName ?? $1.id) }
			if case .edit(let personaName) = mode {
				let detail = try await client.fetchPersonaDetail(name: personaName)
				name = detail.name
				instructions = detail.instructions
				model = detail.model
				promptMode = detail.promptMode
				imagePath = detail.imagePath
				imageUrl = detail.imageUrl
				isBuiltIn = detail.isBuiltIn
			}
		} catch {
			errorMessage = error.localizedDescription
		}
		// Capture the baseline for dirty-tracking / Reset regardless of mode.
		captureSnapshot()
	}

	func save() async {
		guard canSave else { return }
		saveState = .saving
		errorMessage = nil
		defer {
			if case .saving = saveState { saveState = .idle }
		}
		do {
			switch mode {
			case .create:
				_ = try await client.createPersona(
					name: name,
					instructions: instructions,
					model: model,
					promptMode: promptMode,
				)
			case .edit(let originalName):
				_ = try await client.updatePersona(
					originalName: originalName,
					name: isBuiltIn ? nil : (name != originalName ? name : nil),
					instructions: isBuiltIn ? nil : instructions,
					model: model,
					promptMode: isBuiltIn ? nil : promptMode,
				)
			}
			// Re-baseline so hasUnsavedChanges clears after a successful save.
			captureSnapshot()
			saveState = .saved
		} catch {
			saveState = .error(error.localizedDescription)
			errorMessage = error.localizedDescription
		}
	}

	func uploadImage(fileData: Data, filename: String) async {
		guard canEditImage else { return }
		isSavingImage = true
		errorMessage = nil
		defer { isSavingImage = false }
		do {
			let base64 = fileData.base64EncodedString()
			_ = try await client.runConfigureAction(
				"upload-persona-image",
				body: [
					"personaName": name,
					"imageBase64": base64,
					"filename": filename,
				],
			)
			let detail = try await client.fetchPersonaDetail(name: name)
			imagePath = detail.imagePath
			imageUrl = detail.imageUrl
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func resetImage() async {
		guard canEditImage else { return }
		isSavingImage = true
		errorMessage = nil
		defer { isSavingImage = false }
		do {
			_ = try await client.runConfigureAction(
				"reset-persona-image",
				body: ["personaName": name],
			)
			imagePath = nil
			imageUrl = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func delete() async {
		guard case .edit(let personaName) = mode, !isBuiltIn else { return }
		saveState = .saving
		errorMessage = nil
		defer {
			if case .saving = saveState { saveState = .idle }
		}
		do {
			_ = try await client.runConfigureAction(
				"delete-persona",
				body: ["personaName": personaName],
			)
			saveState = .saved
		} catch {
			saveState = .error(error.localizedDescription)
			errorMessage = error.localizedDescription
		}
	}
}
