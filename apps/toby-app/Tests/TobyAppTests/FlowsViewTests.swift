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
			icon: builtin ? nil : "flame",
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
			result: nil,
			destinations: nil,
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
	}

	@Test("flows sidebar shows empty state when no flows")
	func flowsSidebarShowsEmptyState() throws {
		let store = FlowsStore()
		let view = FlowsSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No flows")
		}
	}

	@Test("flows sidebar renders rows when no flow is selected")
	func flowsSidebarRendersRowsWhenNoFlowIsSelected() throws {
		let store = FlowsStore()
		store.flows = [sampleFlow()]
		let view = FlowsSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-sidebar-row-dashboard.email.summary")
		}
	}

	@Test("flows sidebar highlights the selected flow")
	func flowsSidebarHighlightsSelectedFlow() throws {
		let store = FlowsStore()
		let flow = sampleFlow()
		store.flows = [flow]
		store.selectedFlowId = flow.id
		let view = FlowsSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-sidebar-row-\(flow.id)")
		}
		#expect(throws: Never.self) {
			try FlowSidebarRow(flow: flow, isSelected: true)
				.inspect()
				.find(viewWithAccessibilityIdentifier: "flow-sidebar-row-\(flow.id)")
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
			"icon": "sparkles",
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
		#expect(item.icon == "sparkles")
		#expect(item.systemImage == "sparkles")
		#expect(item.nodes.count == 1)
		#expect(item.nodes[0].type == "tool_executor")
		#expect(item.nodes[0].tool?.standardTool == "email.unreadSummary")
		#expect(item.displayName == "Email Summary")
	}

	@Test("custom flow detail shows edit and run")
	func customFlowDetailShowsEditAndRun() throws {
		let store = FlowsStore()
		let flow = sampleFlow(id: "flow.custom", name: "Focus mode", builtin: false)
		store.flows = [flow]
		store.selectedFlowId = flow.id
		let view = FlowDetailContent(store: store, flow: flow)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-edit-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-run-button")
		}
	}

	@Test("editor shows persona menu when an LLM step is present")
	func editorShowsPersonaMenuForLLM() throws {
		let store = FlowsStore()
		store.personaOptions = [
			PersonaOption(
				name: "Toby",
				label: "Toby",
				imagePath: nil,
				imageUrl: nil,
				isDefault: true,
				isBuiltIn: true
			),
		]
		var draft = FlowEditorDraft.blank()
		draft.nodes = [FlowEditorNode.llm()]
		store.editor = draft
		let view = FlowEditorView(
			store: store,
			draft: Binding(
				get: { store.editor ?? draft },
				set: { store.editor = $0 }
			)
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-persona")
		}
	}

	@Test("editor shows curated icon picker")
	func editorShowsCuratedIconPicker() throws {
		let store = FlowsStore()
		var draft = FlowEditorDraft.blank()
		draft.nodes = [FlowEditorNode.llm()]
		let view = FlowEditorView(
			store: store,
			draft: .constant(draft)
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-icon")
		}
		#expect(FlowIconOption.all.contains { $0.symbol == "sparkles" })
	}

	@Test("dashboard destination summary and editor payload")
	func dashboardDestinationSummaryAndEditorPayload() {
		let informational = FlowDestinationSpec(
			type: "dashboard",
			to: nil,
			subject: nil,
			cc: nil,
			channel: nil,
			variant: "informational",
			refresh: nil
		)
		let manual = FlowDestinationSpec(
			type: "dashboard",
			to: nil,
			subject: nil,
			cc: nil,
			channel: nil,
			variant: "informational",
			refresh: "manual"
		)
		let runner = FlowDestinationSpec(
			type: "dashboard",
			to: nil,
			subject: nil,
			cc: nil,
			channel: nil,
			variant: "runner",
			refresh: nil
		)
		#expect(informational.summary == "Dashboard · Informational")
		#expect(manual.summary == "Dashboard · Informational · Manual")
		#expect(runner.summary == "Dashboard · Run now")

		let draft = FlowEditorDestination(spec: runner)
		#expect(draft.type == "dashboard")
		#expect(draft.dashboardVariant == "runner")
		let body = draft.jsonBody()
		#expect(body["type"] as? String == "dashboard")
		#expect(body["variant"] as? String == "runner")
		#expect(body["refresh"] == nil)

		let infoDraft = FlowEditorDestination(spec: informational)
		#expect(infoDraft.dashboardRefresh == "asNeeded")
		let infoBody = infoDraft.jsonBody()
		#expect(infoBody["refresh"] as? String == "asNeeded")

		let manualDraft = FlowEditorDestination(spec: manual)
		#expect(manualDraft.dashboardRefresh == "manual")
		#expect(manualDraft.jsonBody()["refresh"] as? String == "manual")
	}

	@Test("startCreate opens a blank editor")
	func startCreateOpensBlankEditor() async {
		let store = FlowsStore()
		await store.startCreate()
		#expect(store.editor != nil)
		#expect(store.editor?.isNew == true)
		#expect(store.editor?.destinations.first?.type == "modal")
	}

	@Test("flow tool catalog parses daemon-shaped JSON")
	func flowToolCatalogParsesDaemonJSON() throws {
		let json = """
		{
			"modules": [
				{
					"name": "macos",
					"displayName": "macOS",
					"connected": true,
					"tools": [
						{
							"moduleName": "macos",
							"toolName": "macWifiSetPower",
							"displayName": "Set Wi-Fi power",
							"description": "Turn Wi-Fi on/off",
							"readOnly": false,
							"inputSchema": {
								"type": "object",
								"properties": {
									"enabled": { "type": "boolean", "description": "true = On" }
								},
								"required": ["enabled"]
							}
						},
						{
							"moduleName": "macos",
							"toolName": "macWindowsMinimizeAll",
							"displayName": "Minimize all windows",
							"description": "Minimize all windows",
							"readOnly": false,
							"inputSchema": { "type": "object", "properties": {} }
						}
					]
				}
			]
		}
		""".data(using: .utf8)!
		let catalog = try FlowToolCatalog.parse(json)
		#expect(catalog.modules.count == 1)
		#expect(catalog.modules[0].tools.count == 2)
		#expect(catalog.modules[0].tools[0].requiredFields == ["enabled"])
		#expect(catalog.modules[0].tools[0].property(named: "enabled")?.type == "boolean")
	}

	@Test("editor draft encodes const tool inputs")
	func editorDraftEncodesConstToolInputs() {
		var draft = FlowEditorDraft.blank()
		draft.name = "Focus mode"
		var node = FlowEditorNode.tool(
			moduleName: "macos",
			toolName: "macWifiSetPower",
			required: ["enabled"]
		)
		node.constInputs["enabled"] = "false"
		draft.nodes = [node]
		let body = draft.jsonBody()
		#expect(body["name"] as? String == "Focus mode")
		#expect(body["icon"] as? String == FlowIconOption.defaultSymbol)
		let nodes = body["nodes"] as? [[String: Any]]
		#expect(nodes?.count == 1)
		let inputs = nodes?.first?["inputs"] as? [String: Any]
		let enabled = inputs?["enabled"] as? [String: Any]
		#expect(enabled?["const"] as? Bool == false)
	}

	@Test("editor draft preserves a stored curated icon")
	func editorDraftPreservesStoredIcon() {
		let document = FlowDocumentPayload(
			id: "flow.focus",
			name: "Focus mode",
			description: "Prepare for deep work",
			icon: "flame",
			persona: nil,
			nodes: [],
			result: nil,
			destinations: nil
		)
		let draft = FlowEditorDraft.from(document: document)
		#expect(draft.icon == "flame")
		#expect(draft.jsonBody()["icon"] as? String == "flame")
		#expect(FlowIconOption.resolvedSymbol("not.a.symbol") == FlowIconOption.defaultSymbol)
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
