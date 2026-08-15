import Foundation
import Observation

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
	var catalog: FlowToolCatalog?
	var isSaving = false
	var isRunning = false
	var editorError: String?
	var lastRunResult: FlowRunNowResponse?
	var showResultSheet = false
	var pendingDeleteId: String?
	var personaOptions: [PersonaOption] = []

	private let client = TobyClient()

	var selectedFlow: FlowListItem? {
		guard let selectedFlowId else { return nil }
		return flows.first(where: { $0.id == selectedFlowId })
	}

	var builtinCount: Int {
		flows.filter(\.builtin).count
	}

	/// Clears flows state after a Toby home directory switch.
	func resetForHomeSwitch() {
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
		catalog = nil
		isSaving = false
		isRunning = false
		editorError = nil
		lastRunResult = nil
		showResultSheet = false
		pendingDeleteId = nil
		personaOptions = []
	}

	func ensureLoaded() async {
		if hasLoadedOnce { return }
		await load()
	}

	func load() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			flows = try await client.listFlows()
			hasLoadedOnce = true
			if let selectedFlowId, !flows.contains(where: { $0.id == selectedFlowId }) {
				self.selectedFlowId = nil
				runs = []
			} else if let selectedFlowId {
				await loadRuns(for: selectedFlowId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectHome() {
		selectedFlowId = nil
		runs = []
		closeRunDetail()
	}

	func selectFlow(id: String) async {
		guard selectedFlowId != id else { return }
		selectedFlowId = id
		closeRunDetail()
		await loadRuns(for: id)
	}

	func loadRuns(for flowId: String) async {
		isRunsLoading = true
		defer { isRunsLoading = false }
		do {
			runs = try await client.listFlowRuns(flowName: flowId, limit: 50)
		} catch {
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
		defer { isRunDetailLoading = false }
		do {
			selectedRunDetail = try await client.fetchFlowRun(id: id)
		} catch {
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
			if modules.isEmpty {
				editorError = "No integrations are installed. Open Integrations to add a plugin, then try again."
			} else {
				editorError = nil
			}
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
		editor = .blank()
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
			editor = .from(document: document)
		} catch {
			editorError = error.localizedDescription
		}
		_ = await (catalog, personas)
	}

	func cancelEditor() {
		editor = nil
		editorError = nil
	}

	func saveEditor() async {
		guard let draft = editor else { return }
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
			if let index = flows.firstIndex(where: { $0.id == response.flow.id }) {
				flows[index] = response.flow
			} else {
				flows.append(response.flow)
				flows.sort { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
			}
			editor = nil
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
		pendingDeleteId = nil
		do {
			try await client.deleteFlow(id: id)
			flows.removeAll { $0.id == id }
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
	func runFlow(id: String) async -> FlowRunNowResponse? {
		isRunning = true
		errorMessage = nil
		defer { isRunning = false }
		do {
			let response = try await client.runFlow(id: id)
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

	func catalogTool(moduleName: String, toolName: String) -> FlowCatalogTool? {
		catalog?.modules
			.first(where: { $0.name == moduleName })?
			.tools.first(where: { $0.toolName == toolName })
	}

	func isModuleConnected(_ name: String) -> Bool {
		catalog?.modules.contains(where: { $0.name == name }) ?? false
	}
}
