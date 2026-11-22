import Observation

@Observable @MainActor
final class FollowupsSettingsStore {
	var configuration = FollowupsSettingsConfig()
	var sources: [FollowupSource] = []
	var instructions: [FollowupInstruction] = []
	var instructionDrafts: [String: String] = [:]
	var newInstruction = ""
	var providers: [AIProviderInfo] = []
	var savedConfiguration: FollowupsSettingsConfig?
	var isLoading = false
	var isSaving = false
	var isRunning = false
	var errorMessage: String?
	var statusMessage: String?
	var hasLoaded = false

	@ObservationIgnored private let client: TobyClient

	init(client: TobyClient = TobyClient()) {
		self.client = client
	}

	var sourceDefaults: [String: Bool] {
		Dictionary(uniqueKeysWithValues: sources.map { ($0.id, $0.defaultEnabled ?? true) })
	}

	var hasUnsavedChanges: Bool {
		savedConfiguration.map { $0 != configuration } ?? false
	}

	func refresh() async {
		let wasLoaded = hasLoaded
		isLoading = true
		if !wasLoaded { errorMessage = nil }
		defer { isLoading = false }
		do {
			let settings = try await client.fetchFollowupsSettings()
			let fetchedSources = try await client.fetchFollowupSources()
			let fetchedInstructions = try await client.fetchFollowupInstructions()
			if !hasUnsavedChanges || !wasLoaded {
				configuration = settings.followups
				for source in fetchedSources {
					configuration.sources[source.id] = settings.followups.sources[source.id] ?? source.enabled
				}
				savedConfiguration = configuration
			}
			sources = fetchedSources
			instructions = fetchedInstructions
			instructionDrafts = Dictionary(uniqueKeysWithValues: fetchedInstructions.map { ($0.id, $0.text) })
			if let availableProviders = try? await client.fetchAIProviders() {
				providers = availableProviders.filter(\.configured)
			}
			hasLoaded = true
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func save() async {
		guard !isSaving else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			let response = try await client.saveFollowupsSettings(configuration, sourceDefaults: sourceDefaults)
			configuration = response.followups
			for source in sources {
				configuration.sources[source.id] = response.followups.sources[source.id] ?? source.defaultEnabled ?? true
			}
			savedConfiguration = configuration
			statusMessage = "Follow-up settings saved."
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func runNow() async {
		guard !isRunning else { return }
		isRunning = true
		defer { isRunning = false }
		do {
			let result = try await client.runFollowupsNow()
			sources = (try? await client.fetchFollowupSources()) ?? sources
			statusMessage = "Evaluated \(result.evaluated) candidates. Added \(result.opened), resolved \(result.closed)."
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func addInstruction() async {
		let text = newInstruction.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty, !isSaving else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			instructions = try await client.addFollowupInstruction(text)
			instructionDrafts = Dictionary(uniqueKeysWithValues: instructions.map { ($0.id, $0.text) })
			newInstruction = ""
			statusMessage = "Instruction added."
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func saveInstruction(_ id: String) async {
		guard let text = instructionDrafts[id]?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, !isSaving else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			instructions = try await client.updateFollowupInstruction(id: id, text: text)
			instructionDrafts[id] = text
			statusMessage = "Instruction saved."
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteInstruction(_ instruction: FollowupInstruction) async {
		guard !isSaving else { return }
		isSaving = true
		defer { isSaving = false }
		do {
			instructions = try await client.deleteFollowupInstruction(id: instruction.id)
			instructionDrafts.removeValue(forKey: instruction.id)
			statusMessage = "Instruction removed."
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
