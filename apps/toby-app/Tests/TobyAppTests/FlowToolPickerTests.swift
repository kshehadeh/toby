import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Flow tool picker")
struct FlowToolPickerTests {
	private func tool(
		_ module: String,
		_ name: String,
		label: String,
		description: String? = nil,
		standardTool: String? = nil
	) -> FlowCatalogTool {
		FlowCatalogTool(
			moduleName: module,
			toolName: name,
			displayName: label,
			description: description,
			readOnly: true,
			standardTool: standardTool,
			inputSchema: FlowInputSchema(type: "object", properties: [:], required: nil)
		)
	}

	private func script(_ name: String, description: String = "") -> UserScriptTool {
		UserScriptTool(
			id: "tool.\(name.lowercased())", name: name, description: description, language: "applescript",
			inputNames: [], outputKind: "text", currentRevision: 1, source: "", usedBy: []
		)
	}

	private var calendar: FlowCatalogModule {
		FlowCatalogModule(name: "apple-calendar", displayName: "Apple Calendar", connected: true, tools: [
			tool("apple-calendar", "searchCalendarEvents", label: "Search calendar events",
				description: "Search Apple Calendar locally via Calendar.app. Returns event uid, summary."),
			tool("apple-calendar", "listCalendars", label: "List calendars"),
			tool("apple-calendar", "getUpcomingEventsSummary", label: "Upcoming events summary",
				standardTool: "calendar.upcomingSummary"),
		])
	}

	private var notion: FlowCatalogModule {
		FlowCatalogModule(name: "notion", displayName: "Notion", connected: false, tools: [
			tool("notion", "createPage", label: "Create page"),
		])
	}

	@Test("Script Tools come first, then connected integrations, with summaries on top")
	func ordersSections() {
		let sections = FlowToolPickerModel.sections(
			scriptTools: [script("Show Communication Windows Only")],
			modules: [notion, calendar],
			query: ""
		)
		#expect(sections.map(\.title) == ["Script Tools", "Apple Calendar", "Notion"])
		#expect(sections[1].rows.map(\.title) == ["Upcoming events summary", "List calendars", "Search calendar events"])
		#expect(sections[2].kind == .integration(iconURL: nil, connected: false))
		#expect(FlowToolPickerModel.rowCount(sections) == 5)
	}

	@Test("rows carry an action icon and the first sentence of a description")
	func rowsHaveIconsAndShortDescriptions() {
		let rows = FlowToolPickerModel.sections(scriptTools: [], modules: [calendar], query: "")[0].rows
		#expect(rows.map(\.systemImage) == ["text.alignleft", "list.bullet", "magnifyingglass"])
		#expect(rows[2].description == "Search Apple Calendar locally via Calendar.app.")
		#expect(rows[1].description == nil)
	}

	@Test("script tools show a description only when they have one")
	func scriptToolDescriptions() {
		let rows = FlowToolPickerModel.sections(
			scriptTools: [script("Focus", description: "Hide distracting windows."), script("Quiet")],
			modules: [],
			query: ""
		)[0].rows
		#expect(rows.map(\.title) == ["Focus", "Quiet"])
		#expect(rows.map(\.description) == ["Hide distracting windows.", nil])
		#expect(rows.allSatisfy { $0.systemImage == "curlybraces" })
	}

	@Test("search matches tool names, descriptions and integration names")
	func searchMatches() {
		let modules = [calendar, notion]
		let byName = FlowToolPickerModel.sections(scriptTools: [], modules: modules, query: "list")
		#expect(byName.flatMap(\.rows).map(\.title) == ["List calendars"])
		let byDescription = FlowToolPickerModel.sections(scriptTools: [], modules: modules, query: "locally")
		#expect(byDescription.flatMap(\.rows).map(\.title) == ["Search calendar events"])
		let byIntegration = FlowToolPickerModel.sections(scriptTools: [], modules: modules, query: "notion")
		#expect(byIntegration.map(\.title) == ["Notion"])
		#expect(FlowToolPickerModel.sections(scriptTools: [], modules: modules, query: "zzz").isEmpty)
	}

	@Test("action icons follow the tool's leading verb")
	func actionSymbols() {
		#expect(FlowToolPickerModel.actionSymbol(for: tool("x", "createCalendarEvent", label: "")) == "plus.circle")
		#expect(FlowToolPickerModel.actionSymbol(for: tool("x", "updateCalendarEvent", label: "")) == "pencil")
		#expect(FlowToolPickerModel.actionSymbol(for: tool("x", "deleteCalendarEvent", label: "")) == "trash")
		#expect(FlowToolPickerModel.actionSymbol(for: tool("x", "getCalendarEvent", label: "")) == "doc.text")
		#expect(FlowToolPickerModel.actionSymbol(for: tool("x", "sendMessage", label: "")) == "paperplane")
	}

	@Test("picker shows a prominent search and integration sections")
	func pickerShowsSearchAndSections() throws {
		let store = FlowsStore()
		store.catalog = FlowToolCatalog(modules: [calendar])
		let view = FlowToolPickerView(store: store, onPick: { _ in }, onPickUserTool: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "flow-tool-picker-search")
		}
		#expect(throws: Never.self) { try view.inspect().find(text: "Choose a tool") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Apple Calendar") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Upcoming events summary") }
		#expect(throws: (any Error).self) { try view.inspect().find(text: "My Tools") }
	}
}
