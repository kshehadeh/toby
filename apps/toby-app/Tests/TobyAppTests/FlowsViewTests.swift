import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("FlowsView")
struct FlowsViewTests {
	private func sampleFlow(
		id: String = "dashboard.email.summary",
		name: String? = nil,
		description: String? = "Fetch unread inbox items and summarize them.",
		builtin: Bool = true
	) -> FlowListItem {
		FlowListItem(
			id: id,
			name: name ?? id,
			description: description,
			builtin: builtin,
			persona: FlowPersonaSpec(source: "dashboard", name: nil),
			nodes: [
				FlowNodeSnapshot(
					id: "fetch-unread",
					type: "tool_executor",
					tool: FlowToolRef(standardTool: "email.unreadSummary", moduleName: nil, toolName: nil),
					schemaName: nil,
					temperature: nil,
					maxOutputTokens: nil,
					inputs: nil,
					outputs: ["unread": "result"]
				),
				FlowNodeSnapshot(
					id: "summarize",
					type: "llm_prompter",
					tool: nil,
					schemaName: "EmailDashboardSummary",
					temperature: 0.3,
					maxOutputTokens: 3000,
					inputs: nil,
					outputs: ["summary": "object"]
				),
			],
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z"
		)
	}

	@Test("flows detail view renders empty state")
	func flowsDetailViewRendersEmptyState() throws {
		let store = FlowsStore()
		let view = FlowsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Flows")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flows-empty-state")
		}
	}

	@Test("flows home shows cards for listed flows")
	func flowsHomeShowsCards() throws {
		let store = FlowsStore()
		store.flows = [
			sampleFlow(id: "dashboard.email.summary"),
			sampleFlow(id: "dashboard.tasks.summary", description: "Fetch open tasks and summarize them."),
		]
		let view = FlowsHomeView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flows-home-view")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Email Summary")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Tasks Summary")
		}
	}

	@Test("flows sidebar lists flow display names")
	func flowsSidebarListsFlows() throws {
		let store = FlowsStore()
		store.flows = [
			sampleFlow(id: "dashboard.email.summary"),
			sampleFlow(id: "dashboard.calendar.summary", description: "Fetch upcoming events."),
		]
		let view = FlowsSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Email Summary")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Calendar Summary")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "All Flows")
		}
	}

	@Test("flows sidebar shows empty state when no flows")
	func flowsSidebarShowsEmptyState() throws {
		let store = FlowsStore()
		let view = FlowsSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No flows")
		}
	}

	@Test("selected flow shows detail content")
	func selectedFlowShowsDetailContent() throws {
		let store = FlowsStore()
		let flow = sampleFlow()
		store.flows = [flow]
		store.selectedFlowId = flow.id
		let view = FlowsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Email Summary")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Built-in flows can’t be edited or deleted")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "fetch-unread")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "summarize")
		}
	}

	@Test("flows store initializes empty on home")
	func flowsStoreInitializesEmpty() {
		let store = FlowsStore()
		#expect(store.flows.isEmpty)
		#expect(store.selectedFlowId == nil)
		#expect(store.selectedFlow == nil)
		#expect(store.runs.isEmpty)
		#expect(store.isListLoading == false)
		#expect(store.errorMessage == nil)
	}

	@Test("select home clears selection")
	func selectHomeClearsSelection() {
		let store = FlowsStore()
		store.flows = [sampleFlow()]
		store.selectedFlowId = "dashboard.email.summary"
		store.runs = [
			FlowRunSummary(
				id: "r1",
				flowName: "dashboard.email.summary",
				status: "success",
				personaName: "Default",
				provider: "openai",
				model: "gpt-4.1",
				trigger: "dashboard.summary:email",
				error: nil,
				failedNodeId: nil,
				startedAt: "2026-01-01T00:00:00Z",
				completedAt: "2026-01-01T00:00:01Z",
				durationMs: 1000
			),
		]
		store.selectHome()
		#expect(store.selectedFlowId == nil)
		#expect(store.runs.isEmpty)
		#expect(store.selectedRunId == nil)
	}

	@Test("flow list item humanizes dotted ids")
	func flowListItemHumanizesIds() {
		let flow = sampleFlow(id: "dashboard.email.summary")
		#expect(flow.displayName == "Email Summary")
		#expect(flow.personaLabel == "Dashboard")
		#expect(flow.builtin == true)
	}

	@Test("flow list item decodes from JSON")
	func flowListItemDecodesFromJSON() throws {
		let json = """
		{
			"id": "dashboard.email.summary",
			"name": "dashboard.email.summary",
			"description": "Fetch unread inbox items",
			"builtin": true,
			"persona": { "source": "dashboard" },
			"nodes": [
				{
					"id": "fetch-unread",
					"type": "tool_executor",
					"tool": { "standardTool": "email.unreadSummary" },
					"outputs": { "unread": "result" }
				}
			],
			"createdAt": "2026-01-01T00:00:00Z",
			"updatedAt": "2026-01-02T00:00:00Z"
		}
		""".data(using: .utf8)!
		let item = try JSONDecoder().decode(FlowListItem.self, from: json)
		#expect(item.id == "dashboard.email.summary")
		#expect(item.builtin == true)
		#expect(item.nodes.count == 1)
		#expect(item.nodes[0].type == "tool_executor")
		#expect(item.nodes[0].tool?.standardTool == "email.unreadSummary")
		#expect(item.displayName == "Email Summary")
	}

	@Test("flow run summary decodes from JSON")
	func flowRunSummaryDecodesFromJSON() throws {
		let json = """
		{
			"id": "run-1",
			"flowName": "dashboard.email.summary",
			"status": "success",
			"personaName": "Toby",
			"provider": "openai",
			"model": "gpt-4.1",
			"trigger": "dashboard.summary:email",
			"error": null,
			"failedNodeId": null,
			"startedAt": "2026-01-01T12:00:00.000Z",
			"completedAt": "2026-01-01T12:00:02.000Z",
			"durationMs": 2000
		}
		""".data(using: .utf8)!
		let run = try JSONDecoder().decode(FlowRunSummary.self, from: json)
		#expect(run.id == "run-1")
		#expect(run.status == "success")
		#expect(run.durationMs == 2000)
		#expect(run.displayStatus == "Success")
	}
}

@MainActor
@Suite("FlowsNavigation")
struct FlowsNavigationTests {
	@Test("detail route includes flows case")
	func detailRouteIncludesFlows() {
		#expect(DetailRoute.allCases.contains(.flows))
	}

	@Test("flows route raw value is 'flows'")
	func flowsRouteRawValue() {
		#expect(DetailRoute.flows.rawValue == "flows")
		#expect(DetailRoute.flows.menuTitle == "Flows")
		#expect(DetailRoute.flows.systemImage == "arrow.triangle.branch")
	}
}
