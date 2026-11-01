import Foundation
import Observation

@MainActor
protocol FlowsFetching {
	func listFlows() async throws -> [FlowListItem]
}

extension TobyClient: FlowsFetching {}

@Observable
@MainActor
final class FlowsStore {
	var flows: [FlowListItem] = []
	/// `nil` means the home / all-flows cards view is showing.
	var selectedFlowId: String?
	var runs: [FlowRunSummary] = []
	var selectedRunId: String?
	var selectedRunDetail: FlowRunDetail?
	var isListLoading = false
	var isRunsLoading = false
	var isRunDetailLoading = false
	var hasLoadedOnce = false
	var errorMessage: String?
	var runDetailError: String?
	var editor: FlowEditorDraft?
	var editorBaseline: FlowEditorDraft?
	var catalog: FlowToolCatalog?
	var isSaving = false
	var isRunning = false
	var editorError: String?
	var lastRunResult: FlowRunNowResponse?
	var showResultSheet = false
	var pendingDeleteId: String?
	var personaOptions: [PersonaOption] = []
	/// Details / Recent runs tab in the flow detail.
	var selectedDetailTab: FlowDetailTab = .details

	var isEditorDirty: Bool {
		guard let editor else { return false }
		return editor != editorBaseline
	}

	private let client = TobyClient()
	private let flowReader: any FlowsFetching
	private var isQuietRefreshing = false
	private var listGeneration = UUID()

	init(flowReader: any FlowsFetching = TobyClient()) {
		self.flowReader = flowReader
	}

	var selectedFlow: FlowListItem? {
		guard let selectedFlowId else { return nil }
		return flows.first(where: { $0.id == selectedFlowId })
	}

	var builtinCount: Int {
		flows.filter(\.builtin).count
	}

	/// Clears flows state after a Toby home directory switch.
	func resetForHomeSwitch() {
		invalidateListRequests()
		flows = []
		selectedFlowId = nil
		runs = []
		selectedRunId = nil
		selectedRunDetail = nil
		isListLoading = false
		isRunsLoading = false
		isRunDetailLoading = false
		hasLoadedOnce = false
		errorMessage = nil
		runDetailError = nil
		editor = nil
		editorBaseline = nil
		catalog = nil
		isSaving = false
		isRunning = false
		editorError = nil
		lastRunResult = nil
		showResultSheet = false
		pendingDeleteId = nil
		personaOptions = []
		selectedDetailTab = .details
	}

	func ensureLoaded() async {
		if hasLoadedOnce {
			await refreshQuietly()
		} else {
			await load()
		}
	}

	func load() async {
		guard !isListLoading, !isQuietRefreshing, !isSaving else { return }
		let generation = listGeneration
		isListLoading = true
		errorMessage = nil
		defer { if listGeneration == generation { isListLoading = false } }
		do {
			let loaded = try await flowReader.listFlows()
			guard listGeneration == generation, !Task.isCancelled else { return }
			applyFlows(loaded)
			if let selectedFlowId {
				await loadRuns(for: selectedFlowId)
			}
		} catch {
			guard listGeneration == generation, !Task.isCancelled else { return }
			errorMessage = error.localizedDescription
		}
	}

	/// Reconcile external writes without spinners, changing tabs, or replacing an editor draft.
	func refreshQuietly() async {
		guard !isListLoading, !isQuietRefreshing, !isSaving else { return }
		let generation = listGeneration
		isQuietRefreshing = true
		defer { if listGeneration == generation { isQuietRefreshing = false } }
		do {
			let loaded = try await flowReader.listFlows()
			guard listGeneration == generation, !Task.isCancelled, !isSaving else { return }
			applyFlows(loaded)
		} catch {
			// Preserve content and visible errors; the next poll or manual refresh retries.
		}
	}

	/// Owned by the view's task so leaving Flows cancels polling automatically.
	func pollForChanges(interval: Duration = .seconds(5)) async {
		while !Task.isCancelled {
			do { try await Task.sleep(for: interval) } catch { return }
			guard !Task.isCancelled else { return }
			await refreshQuietly()
		}
	}

	private func applyFlows(_ loaded: [FlowListItem]) {
		if flows != loaded { flows = loaded }
		hasLoadedOnce = true
		if let selectedFlowId, !loaded.contains(where: { $0.id == selectedFlowId }) {
			selectHome()
		}
	}

	private func invalidateListRequests() {
		listGeneration = UUID()
		isListLoading = false
		isQuietRefreshing = false
	}

	func selectHome() {
		selectedFlowId = nil
		runs = []
		isRunsLoading = false
		selectedDetailTab = .details
		closeRunDetail()
	}

	func selectFlow(id: String) async {
		guard selectedFlowId != id else { return }
		selectedFlowId = id
		selectedDetailTab = .details
		closeRunDetail()
		await loadRuns(for: id)
	}

	func loadRuns(for flowId: String) async {
		isRunsLoading = true
		defer {
			if selectedFlowId == flowId { isRunsLoading = false }
		}
		do {
			let loaded = try await client.listFlowRuns(flowName: flowId, limit: 50)
			guard selectedFlowId == flowId else { return }
			runs = loaded
		} catch {
			guard selectedFlowId == flowId else { return }
			// Keep prior runs visible; surface the error on the detail surface.
			errorMessage = error.localizedDescription
		}
	}

	func refreshSelectedRuns() async {
		guard let selectedFlowId else { return }
		await loadRuns(for: selectedFlowId)
	}

	func selectRun(id: String) async {
		selectedRunId = id
		selectedRunDetail = nil
		runDetailError = nil
		isRunDetailLoading = true
		defer {
			if selectedRunId == id { isRunDetailLoading = false }
		}
		do {
			let loaded = try await client.fetchFlowRun(id: id)
			guard selectedRunId == id else { return }
			selectedRunDetail = loaded
		} catch {
			guard selectedRunId == id else { return }
			runDetailError = error.localizedDescription
		}
	}

	func closeRunDetail() {
		selectedRunId = nil
		selectedRunDetail = nil
		runDetailError = nil
		isRunDetailLoading = false
	}

	func loadCatalog() async {
		do {
			let loaded = try await client.fetchPlugins()
			let modules = loaded.plugins.compactMap(FlowCatalogModule.init(plugin:))
			catalog = FlowToolCatalog(modules: modules)
			editorError = nil
		} catch {
			catalog = nil
			editorError = "Couldn’t load integrations: \(error.localizedDescription)"
		}
	}

	func loadPersonas() async {
		do {
			personaOptions = try await client.listPersonas()
		} catch {
			personaOptions = []
		}
	}

	func startCreate() async {
		editorError = nil
		let draft = FlowEditorDraft.blank()
		editor = draft
		editorBaseline = draft
		async let catalog: () = loadCatalog()
		async let personas: () = loadPersonas()
		_ = await (catalog, personas)
	}

	func startEdit(id: String) async {
		editorError = nil
		async let catalog: () = loadCatalog()
		async let personas: () = loadPersonas()
		do {
			let document = try await client.fetchFlowDocument(id: id)
			let draft = FlowEditorDraft.from(document: document)
			editor = draft
			editorBaseline = draft
		} catch {
			editorError = error.localizedDescription
		}
		_ = await (catalog, personas)
	}

	func cancelEditor() {
		editor = nil
		editorBaseline = nil
		editorError = nil
	}

	func saveEditor() async {
		guard let draft = editor else { return }
		if let error = draft.outputValidationError { editorError = error; return }
		isSaving = true
		editorError = nil
		defer { isSaving = false }
		do {
			let response: FlowMutationResponse
			if let existingId = draft.existingId {
				response = try await client.updateFlow(id: existingId, body: draft.jsonBody())
			} else {
				response = try await client.createFlow(body: draft.jsonBody())
			}
			invalidateListRequests()
			if let index = flows.firstIndex(where: { $0.id == response.flow.id }) {
				flows[index] = response.flow
			} else {
				flows.append(response.flow)
				flows.sort { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
			}
			NotificationCenter.default.post(name: .flowDefinitionsDidChange, object: nil)
			editor = nil
			editorBaseline = nil
			await selectFlow(id: response.flow.id)
		} catch {
			editorError = error.localizedDescription
		}
	}

	func confirmDelete(id: String) {
		pendingDeleteId = id
	}

	func cancelDelete() {
		pendingDeleteId = nil
	}

	func deleteFlow(id: String) async {
		guard !isSaving else { return }
		isSaving = true
		defer { isSaving = false }
		pendingDeleteId = nil
		do {
			try await client.deleteFlow(id: id)
			invalidateListRequests()
			flows.removeAll { $0.id == id }
			NotificationCenter.default.post(name: .flowDefinitionsDidChange, object: nil)
			if selectedFlowId == id {
				selectHome()
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func runSelected() async {
		guard let selectedFlowId else { return }
		_ = await runFlow(id: selectedFlowId)
	}

	/// Run a custom flow without changing the Flows selection.
	@discardableResult
	func runFlow(id: String, source: String = "manual") async -> FlowRunNowResponse? {
		isRunning = true
		errorMessage = nil
		defer { isRunning = false }
		do {
			let response = try await client.runFlow(id: id, source: source)
			lastRunResult = response
			let wantsModal = response.destinations?.contains(where: { $0.type == "modal" }) ?? false
			if response.ok, wantsModal {
				showResultSheet = true
			} else if !response.ok {
				errorMessage = response.error ?? "Flow failed"
				if selectedFlowId == id, let runId = response.runId {
					await selectRun(id: runId)
				}
			} else if selectedFlowId == id, let runId = response.runId {
				await selectRun(id: runId)
			}
			if selectedFlowId == id {
				await refreshSelectedRuns()
			}
			return response
		} catch {
			errorMessage = error.localizedDescription
			return nil
		}
	}

	func closeResultSheet() {
		showResultSheet = false
	}

	func catalogTool(moduleName: String, toolName: String, standardTool: String? = nil) -> FlowCatalogTool? {
		if let standardTool {
			return catalog?.modules.flatMap(\.tools).first(where: { $0.standardTool == standardTool })
		}
		return catalog?.modules
			.first(where: { $0.name == moduleName })?
			.tools.first(where: { $0.toolName == toolName })
	}

	func catalogModule(named name: String) -> FlowCatalogModule? {
		catalog?.modules.first(where: { $0.name == name })
	}

	func isModuleConnected(_ name: String) -> Bool {
		catalog?.modules.contains(where: { $0.name == name }) ?? false
	}
}
