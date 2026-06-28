import Foundation
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

	let mode: Mode
	var name = ""
	var instructions = ""
	var provider = "openai"
	var model = "gpt-5-mini"
	var promptMode = "add"
	var imagePath: String?
	var imageUrl: String?
	var isBuiltIn = false
	var providers: [AIProviderInfo] = []
	var isLoading = false
	var isSavingImage = false
	var saveState: SaveState = .idle
	var errorMessage: String?

	private let client = TobyClient()

	init(mode: Mode) {
		self.mode = mode
	}

	var isNameEditable: Bool {
		if mode.isCreate { return true }
		return !isBuiltIn
	}

	var hasCustomImage: Bool {
		guard let imagePath, !imagePath.isEmpty else { return false }
		return true
	}

	var displayImageURL: URL {
		if let imageUrl,
			let url = URL(string: ConfigReader.baseURL().absoluteString + imageUrl)
		{
			return url
		}
		return ConfigReader.baseURL()
			.appendingPathComponent("api/personas/image/default.png")
	}

	var availableModels: [String] {
		guard let info = providers.first(where: { $0.providerId == provider }) else {
			return [model]
		}
		var models = info.models
		if !model.isEmpty && !models.contains(model) {
			models.append(model)
		}
		return models
	}

	var canSave: Bool {
		guard !isLoading, saveState != .saving else { return false }
		guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			return false
		}
		return true
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			providers = try await client.fetchAIProviders()
			if case .edit(let personaName) = mode {
				let detail = try await client.fetchPersonaDetail(name: personaName)
				name = detail.name
				instructions = detail.instructions
				provider = detail.provider
				model = detail.model
				promptMode = detail.promptMode
				imagePath = detail.imagePath
				imageUrl = detail.imageUrl
				isBuiltIn = detail.isBuiltIn
			}
		} catch {
			errorMessage = error.localizedDescription
		}
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
					provider: provider,
					model: model,
					promptMode: promptMode,
				)
			case .edit(let originalName):
				_ = try await client.updatePersona(
					originalName: originalName,
					name: name != originalName ? name : nil,
					instructions: instructions,
					provider: provider,
					model: model,
					promptMode: promptMode,
				)
			}
			saveState = .saved
		} catch {
			saveState = .error(error.localizedDescription)
			errorMessage = error.localizedDescription
		}
	}

	func uploadImage(fileData: Data, filename: String) async {
		guard case .edit = mode else { return }
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
		guard case .edit = mode else { return }
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
}
