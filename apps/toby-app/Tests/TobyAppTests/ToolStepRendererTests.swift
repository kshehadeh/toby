import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("ToolStepRenderer")
struct ToolStepRendererTests {
	// MARK: - Helpers

	private func makeState() -> ChatTurnMutationState {
		ChatTurnMutationState(
			transcript: [],
			streamingAssistant: nil,
			activityLine: "Ready",
			assistantHeader: "",
			assistantBuffer: "",
			sawToolCallThisTurn: false,
			personaFallback: "Assistant",
		)
	}

	private func apply(_ json: String, to state: inout ChatTurnMutationState) throws {
		let event = try JSONDecoder().decode(ChatEventPayload.self, from: Data(json.utf8))
		ChatTurnEngine.apply(event: event, state: &state)
	}

	private func onlyPayload(_ state: ChatTurnMutationState) throws -> BoxedStepPayload {
		#expect(state.transcript.count == 1)
		guard case .boxedStep(let payload) = try #require(state.transcript.first) else {
			Issue.record("expected boxedStep")
			throw CancellationError()
		}
		return payload
	}

	private let searchPresentation = #"{"kind":"search","verbs":["Searching the web","Searched the web"],"argChips":["query","search_recency_filter"],"primaryArg":"query"}"#

	private func context(
		toolName: String = "webSearch",
		args: [String: ToolArgValue] = [:],
		presentation: ToolPresentation? = nil,
		progress: ToolStepProgress? = nil,
		phase: ToolStepPhase = .done,
		summary: String = "",
		integrationLabel: String? = nil,
	) -> ToolStepContext {
		ToolStepContext(
			toolName: toolName,
			integrationLabel: integrationLabel,
			args: args,
			presentation: presentation,
			progress: progress,
			phase: phase,
			resultSummary: summary,
			fallbackTitle: "Fallback title",
		)
	}

	// MARK: - ChatTurnEngine

	@Test("tool_call_start stores display args and presentation")
	func startStoresArgs() throws {
		var state = makeState()
		try apply(#"{"type":"tool_call_start","blockKey":"b1","toolName":"webSearch","args":{"query":["eu ai act","gpai"],"content":"hidden"},"presentation":\#(searchPresentation)}"#, to: &state)
		let payload = try onlyPayload(state)
		#expect(payload.args == ["query": .list(["eu ai act", "gpai"])])
		#expect(payload.presentation?.kind == .search)
		#expect(payload.body == "Running…")
	}

	@Test("repeat tool_call_start updates the row in place")
	func repeatStartUpdatesInPlace() throws {
		var state = makeState()
		try apply(#"{"type":"tool_call_start","blockKey":"b1","toolName":"webSearch","args":{}}"#, to: &state)
		try apply(#"{"type":"tool_call_start","blockKey":"b1","toolName":"webSearch","args":{"query":"late"}}"#, to: &state)
		let payload = try onlyPayload(state)
		#expect(payload.args == ["query": .string("late")])
	}

	@Test("progress populates the live rail and completion folds it away")
	func progressThenComplete() throws {
		var state = makeState()
		try apply(#"{"type":"tool_call_start","blockKey":"b1","toolName":"webSearch","args":{"query":"q"}}"#, to: &state)
		try apply(#"{"type":"tool_call_progress","blockKey":"b1","toolName":"webSearch","items":[{"id":"q0","label":"q","state":"running"}],"fraction":0.5}"#, to: &state)
		#expect(try onlyPayload(state).progress == ToolStepProgress(
			items: [ToolProgressItem(id: "q0", label: "q", state: .running)],
			fraction: 0.5,
		))

		try apply(#"{"type":"tool_call_complete","blockKey":"b1","toolName":"webSearch","args":{"query":"q"},"result":{"results":[]},"durationMs":900,"summary":"No results"}"#, to: &state)
		let done = try onlyPayload(state)
		#expect(done.progress == nil)
		#expect(done.body == "No results")
		#expect(done.failed == false)

		// Late progress must not resurrect the rail.
		try apply(#"{"type":"tool_call_progress","blockKey":"b1","toolName":"webSearch","items":[{"id":"q0","label":"q","state":"done"}]}"#, to: &state)
		#expect(try onlyPayload(state).progress == nil)
	}

	@Test("failed completion keeps the frozen rail and marks the step failed")
	func failedKeepsRail() throws {
		var state = makeState()
		try apply(#"{"type":"tool_call_start","blockKey":"b1","toolName":"webSearch","args":{}}"#, to: &state)
		try apply(#"{"type":"tool_call_progress","blockKey":"b1","toolName":"webSearch","items":[{"id":"q0","label":"q","state":"failed","detail":"429"}]}"#, to: &state)
		try apply(#"{"type":"tool_call_complete","blockKey":"b1","toolName":"webSearch","args":{},"result":{"error":"rate limited"},"durationMs":3000}"#, to: &state)
		let payload = try onlyPayload(state)
		#expect(payload.failed == true)
		#expect(payload.progress?.items.first?.detail == "429")
	}

	// MARK: - Decoding

	@Test("persisted tool steps decode args, presentation, and run args")
	func decodesPersistedFields() throws {
		let json = """
		{"kind":"boxed_step","id":"b1","seq":1,"variant":"tool","header":"Fetch open tasks","body":"",
		 "toolName":"fetchOpenTasks","failed":true,"args":{"limit":30,"flag":true},
		 "presentation":{"kind":"list","verbs":["Fetching open tasks","Fetched open tasks"]},
		 "toolRuns":[{"blockKey":"r1","header":"h","body":"b","args":{"query":"x"},"failed":false}]}
		"""
		let entry = try JSONDecoder().decode(TranscriptEntry.self, from: Data(json.utf8))
		guard case .boxedStep(let payload) = entry else {
			Issue.record("expected boxedStep")
			return
		}
		#expect(payload.args == ["limit": .number(30), "flag": .bool(true)])
		#expect(payload.presentation?.kind == .list)
		#expect(payload.presentation?.doneVerb == "Fetched open tasks")
		#expect(payload.failed == true)
		#expect(payload.toolRuns?.first?.args == ["query": .string("x")])
	}

	@Test("unknown presentation kinds decode as generic")
	func unknownKindIsGeneric() throws {
		let presentation = try JSONDecoder().decode(
			ToolPresentation.self,
			from: Data(#"{"kind":"hologram"}"#.utf8),
		)
		#expect(presentation.kind == .generic)
	}

	// MARK: - Renderers

	@Test("web search uses verbs, query chips, and recency labels")
	func webSearchRendering() {
		let running = ToolStepDisplay.resolve(context(
			args: ["query": .list(["eu ai act", "gpai"]), "search_recency_filter": .string("week")],
			progress: ToolStepProgress(items: [ToolProgressItem(id: "q0", label: "eu ai act", state: .running)]),
			phase: .running,
		))
		#expect(running.title == "Searching the web")
		#expect(running.systemImage == "globe")
		#expect(running.chips.map(\.text) == ["eu ai act", "gpai", "past week"])
		#expect(running.chips.first?.isLiteral == true)
		#expect(running.liveItems.count == 1)
		#expect(running.summary.isEmpty)

		let done = ToolStepDisplay.resolve(context(
			args: ["query": .string("eu ai act")],
			progress: ToolStepProgress(items: [ToolProgressItem(id: "q0", label: "eu ai act", state: .done)]),
			summary: "8 results · reuters.com",
		))
		#expect(done.title == "Searched the web")
		#expect(done.liveItems.isEmpty)
		#expect(done.summary == "8 results · reuters.com")
	}

	@Test("plugin presentation selects the kind renderer with integration prefix")
	func pluginKindRendering() {
		let display = ToolStepDisplay.resolve(context(
			toolName: "fetchOpenTasks",
			args: ["limit": .number(30)],
			presentation: ToolPresentation(kind: .list, verbs: ["Fetching open tasks", "Fetched open tasks"]),
			phase: .running,
			integrationLabel: "Todoist",
		))
		#expect(display.title == "Todoist: Fetching open tasks")
		#expect(display.chips.map(\.text) == ["30"])
		#expect(display.chips.first?.systemImage == "line.3.horizontal.decrease")
	}

	@Test("generic renderer shows key-value chips, preferred keys first")
	func genericRendering() {
		let display = ToolStepDisplay.resolve(context(
			toolName: "syncWidgets",
			args: ["workspace": .string("prod"), "dryRun": .bool(false), "query": .string("w"), "zeta": .number(1)],
			summary: "Found 42 widget(s).",
		))
		#expect(display.title == "Sync widgets")
		#expect(display.chips.map(\.text) == ["w", "false", "prod"])
		#expect(display.chips[1].key == "dryRun: ")
		#expect(display.summary == "Found 42 widget(s).")
	}

	@Test("generic renderer without args keeps the legacy header")
	func genericFallbackTitle() {
		let display = ToolStepDisplay.resolve(context(toolName: "syncWidgets"))
		#expect(display.title == "Fallback title")
	}

	@Test("chips overflow into a +n chip")
	func chipOverflow() {
		let display = ToolStepDisplay.resolve(context(
			args: ["query": .list(["a", "b", "c", "d", "e"])],
		))
		#expect(display.chips.map(\.text) == ["a", "b", "c", "+2"])
	}

	@Test("cached steps hide the placeholder cached summary")
	func cachedSummary() {
		let display = ToolStepDisplay.resolve(context(phase: .cached, summary: "Done. Cached result."))
		#expect(display.summary.isEmpty)
		#expect(display.phase == .cached)
	}

	@Test("registry prefers tool-name overrides over kind")
	func registryOverride() {
		struct Custom: ToolStepRenderer {
			func title(_ context: ToolStepContext) -> String { "Custom" }
		}
		ToolStepRendererRegistry.register(Custom(), forToolName: "customTool")
		let display = ToolStepDisplay.resolve(context(
			toolName: "customTool",
			presentation: ToolPresentation(kind: .search),
		))
		#expect(display.title == "Custom")
	}

	// MARK: - Views

	private func runningGroup() -> TranscriptWorkGroup {
		var payload = BoxedStepPayload(
			id: "b1",
			seq: 1,
			variant: "tool",
			header: "Search the web",
			body: "Running…",
			toolName: "webSearch",
			integrationLabel: nil,
			cacheHit: nil,
			durationMs: nil,
			toolRuns: nil,
			fullBody: nil,
		)
		payload.args = ["query": .string("eu ai act")]
		payload.progress = ToolStepProgress(items: [
			ToolProgressItem(id: "q0", label: "Scanning sources", state: .running, detail: "3 found"),
		])
		return TranscriptWorkGroup(
			id: "work-0",
			entries: [.boxedStep(payload)],
			userTurnIndex: 0,
			durationMs: nil,
			isActive: true,
		)
	}

	@Test("collapsed running work shows the active step with its live rail")
	func collapsedRunningShowsLiveStep() throws {
		let view = WorkedForRow(
			group: runningGroup(),
			duration: nil,
			activeWorkStartDate: Date(),
			isExpanded: false,
			onToggle: {},
		)
		let row = try view.inspect().find(ToolStepRow.self)
		#expect(try row.find(text: "Searching the web").string() == "Searching the web")
		#expect(try row.find(text: "eu ai act").string() == "eu ai act")
		#expect(try row.find(text: "Scanning sources").string() == "Scanning sources")
		#expect(try row.find(text: "3 found").string() == "3 found")
	}

	@Test("completed tool row shows summary and no live rail")
	func completedRowShowsSummary() throws {
		let step = WorkStep(
			id: "b1",
			type: .tool,
			title: "Search the web",
			body: "8 results · reuters.com",
			fullBody: nil,
			durationMs: 2_300,
			isActive: false,
			cacheHit: false,
			toolName: "webSearch",
			count: 1,
			children: [],
			args: ["query": .string("eu ai act")],
		)
		let display = try #require(step.toolDisplay())
		let view = ToolStepRow(step: step, display: display)
		#expect(try view.inspect().find(text: "8 results · reuters.com").string() == "8 results · reuters.com")
		#expect(throws: (any Error).self) { try view.inspect().find(ToolLiveRail.self) }
	}
}
