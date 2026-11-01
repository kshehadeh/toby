import Foundation
import Testing
@testable import TobyApp

@MainActor
private final class FakeFlowsReader: FlowsFetching {
	var flows: [FlowListItem] = []
	var error: Error?
	var callCount = 0
	var pauseNextRequest = false
	var pendingResponse: CheckedContinuation<[FlowListItem], Never>?

	func listFlows() async throws -> [FlowListItem] {
		callCount += 1
		if let error { throw error }
		if pauseNextRequest {
			pauseNextRequest = false
			return await withCheckedContinuation { pendingResponse = $0 }
		}
		return flows
	}
}

@MainActor
@Suite("FlowsStore external changes")
struct FlowsStoreTests {
	private func flow(id: String = "flow.focus", name: String = "Focus") -> FlowListItem {
		FlowListItem(
			id: id, name: name, description: nil, icon: "flame", color: "teal",
			builtin: false, persona: nil, nodes: [], result: nil, destinations: nil,
			createdAt: nil, updatedAt: nil
		)
	}

	@Test("returning to cached Flows fetches additions and edits")
	func reopeningRefreshesCachedFlows() async {
		let reader = FakeFlowsReader()
		reader.flows = [flow()]
		let store = FlowsStore(flowReader: reader)
		await store.ensureLoaded()
		store.selectedFlowId = "flow.focus"
		store.selectedDetailTab = .recentRuns

		reader.flows = [flow(name: "Updated focus"), flow(id: "flow.new", name: "New flow")]
		await store.ensureLoaded()

		#expect(reader.callCount == 2)
		#expect(store.flows == reader.flows)
		#expect(store.selectedFlow?.name == "Updated focus")
		#expect(store.selectedDetailTab == .recentRuns)
		#expect(!store.isListLoading)
	}

	@Test("external updates preserve the open editor and baseline")
	func preservesEditorDraft() async {
		let reader = FakeFlowsReader()
		let store = FlowsStore(flowReader: reader)
		let baseline = FlowEditorDraft.blank()
		var draft = baseline
		draft.name = "Unsaved work"
		store.editorBaseline = baseline
		store.editor = draft
		reader.flows = [flow(name: "Changed elsewhere")]

		await store.refreshQuietly()

		#expect(store.flows == reader.flows)
		#expect(store.editor == draft)
		#expect(store.editorBaseline == baseline)
		#expect(store.isEditorDirty)
	}

	@Test("deleting the selected flow externally clears selection and run detail")
	func deletionClearsSelection() async {
		let reader = FakeFlowsReader()
		let store = FlowsStore(flowReader: reader)
		store.flows = [flow()]
		store.selectedFlowId = "flow.focus"
		store.selectedRunId = "run.deleted"
		store.runDetailError = "Old detail error"
		store.selectedDetailTab = .recentRuns

		await store.refreshQuietly()

		#expect(store.flows.isEmpty)
		#expect(store.selectedFlowId == nil)
		#expect(store.selectedRunId == nil)
		#expect(store.selectedRunDetail == nil)
		#expect(store.runDetailError == nil)
		#expect(store.runs.isEmpty)
		#expect(store.selectedDetailTab == .details)
	}

	@Test("quiet failures retain content and errors, then retry successfully")
	func quietFailureRetries() async {
		let reader = FakeFlowsReader()
		let store = FlowsStore(flowReader: reader)
		store.flows = [flow()]
		store.errorMessage = "Keep this error"
		reader.error = TobyClientError.serverError("Offline")

		await store.refreshQuietly()
		#expect(store.flows == [flow()])
		#expect(store.errorMessage == "Keep this error")
		#expect(!store.isListLoading)

		reader.error = nil
		reader.flows = [flow(name: "New content")]
		await store.refreshQuietly()
		#expect(store.flows == reader.flows)
	}

	@Test("quiet refresh skips a local save")
	func refreshSkipsSaving() async {
		let reader = FakeFlowsReader()
		let store = FlowsStore(flowReader: reader)
		store.isSaving = true
		await store.refreshQuietly()
		#expect(reader.callCount == 0)
	}

	@Test("home switch ignores the previous home's in-flight response")
	func homeSwitchDiscardsOldResponse() async {
		let reader = FakeFlowsReader()
		let store = FlowsStore(flowReader: reader)
		reader.pauseNextRequest = true
		let request = Task { await store.refreshQuietly() }
		for _ in 0..<100 where reader.pendingResponse == nil { await Task.yield() }
		let pending = reader.pendingResponse
		#expect(pending != nil)

		store.resetForHomeSwitch()
		reader.flows = [flow(id: "flow.new-home")]
		await store.ensureLoaded()
		pending?.resume(returning: [flow(id: "flow.old-home")])
		await request.value

		#expect(store.flows == reader.flows)
		#expect(store.hasLoadedOnce)
	}

	@Test("visible polling fetches external changes and stops on cancellation")
	func pollingFollowsViewLifetime() async throws {
		let reader = FakeFlowsReader()
		let store = FlowsStore(flowReader: reader)
		reader.flows = [flow(id: "flow.external")]
		let polling = Task { await store.pollForChanges(interval: .milliseconds(1)) }
		for _ in 0..<100 where store.flows != reader.flows {
			try await Task.sleep(for: .milliseconds(1))
		}
		polling.cancel()
		await polling.value
		#expect(reader.callCount > 0)
		#expect(store.flows == reader.flows)
		let calls = reader.callCount
		try await Task.sleep(for: .milliseconds(5))
		#expect(reader.callCount == calls)
	}
}
