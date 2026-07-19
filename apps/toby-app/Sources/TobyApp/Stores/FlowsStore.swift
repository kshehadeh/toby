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

	private let client = TobyClient()

	var selectedFlow: FlowListItem? {
		guard let selectedFlowId else { return nil }
		return flows.first(where: { $0.id == selectedFlowId })
	}

	var builtinCount: Int {
		flows.filter(\.builtin).count
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
}
