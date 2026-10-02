import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Flow editor round trips")
struct FlowEditorRoundTripTests {
	@Test("editor exposes Jira data and inserts its reference into the LLM prompt")
	func insertsJiraReference() throws {
		let data = """
		{ "id": "jira", "type": "tool_executor",
		  "tool": { "moduleName": "jira", "toolName": "searchJiraIssues" },
		  "outputs": { "jiraIssues": "result" } }
		""".data(using: .utf8)!
		let jira = FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: data))
		let store = FlowsStore()
		var draft = FlowEditorDraft.blank()
		draft.nodes = [jira, .llm()]
		store.editor = draft
		let view = FlowEditorView(store: store, draft: editorDraftBinding(
			Binding(get: { store.editor }, set: { store.editor = $0 }), fallback: .blank()
		))
		#expect(throws: Never.self) { try view.inspect().find(text: "{{json bag.jiraIssues}}") }
		try view.inspect().find(button: "Step 1 · jiraIssues").tap()
		#expect(store.editor?.nodes.last?.userPrompt.hasSuffix("{{json bag.jiraIssues}}") == true)
	}

	@Test("prompt data references use output keys and the latest writer")
	func promptDataReferences() throws {
		let data = """
		{ "id": "jira", "type": "tool_executor",
		  "tool": { "moduleName": "jira", "toolName": "searchJiraIssues" },
		  "outputs": { "jiraIssues": "result" } }
		""".data(using: .utf8)!
		let jira = FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: data))
		let first = FlowEditorNode.tool(moduleName: "todoist", toolName: "tasks", required: [])
		let second = FlowEditorNode.tool(moduleName: "calendar", toolName: "events", required: [])
		let llm = FlowEditorNode.llm()
		var draft = FlowEditorDraft.blank()
		draft.nodes = [first, second, jira, llm]
		let outputs = draft.promptOutputs(before: llm.id)
		#expect(outputs.map(\.key) == ["result", "jiraIssues"])
		#expect(outputs.first?.stepId == second.id)
		#expect(outputs.last?.token == "{{json bag.jiraIssues}}")
		#expect(draft.promptOutputs(before: first.id).isEmpty)
		#expect(jira.outputKeys == ["jiraIssues"])
	}

	@Test("changing a destination preserves standard tools, wiring, and LLM settings")
	func preservesStoredRecipe() throws {
		let json = """
		{
		  "id": "flow.calendar", "name": "Calendar brief",
		  "persona": { "source": "dashboard" },
		  "nodes": [
		    {
		      "id": "fetch", "type": "tool_executor",
		      "tool": { "standardTool": "calendar.upcomingSummary" },
		      "inputs": { "limit": { "const": 10 }, "calendarId": { "const": "123" }, "ids": { "const": ["a", "b"] } },
		      "outputs": { "upcoming": "result" }
		    },
		    {
		      "id": "summarize", "type": "llm_prompter",
		      "schema": { "kind": "markdown" }, "schemaName": "CalendarBrief",
		      "systemPrompt": "Summarize events", "userPrompt": "{{json bag.upcoming}}",
		      "outputs": { "summary": "object" },
		      "promptHelpers": { "composePersona": true, "appendCurrentDateTime": true },
		      "temperature": 0.2, "maxOutputTokens": 1000, "timeoutMs": 30000
		    }
		  ],
		  "result": { "from": "summary", "path": "markdown" },
		  "destinations": [{ "type": "modal" }]
		}
		""".data(using: .utf8)!
		let document = try JSONDecoder().decode(FlowDocumentPayload.self, from: json)
		var draft = FlowEditorDraft.from(document: document)
		draft.destinations = [.dashboard()]
		let body = draft.jsonBody()
		let original = try #require(JSONSerialization.jsonObject(with: json) as? [String: Any])
		let originalNodes = try #require(original["nodes"] as? NSArray)
		let savedNodes = try #require(body["nodes"] as? NSArray)
		#expect(originalNodes.isEqual(savedNodes))
		#expect((body["result"] as? NSDictionary)?.isEqual(original["result"]) == true)
		#expect((body["persona"] as? NSDictionary)?.isEqual(original["persona"]) == true)
		#expect((body["destinations"] as? [[String: Any]])?.first?["variant"] as? String == "informational")
		#expect(JSONSerialization.isValidJSONObject(body))
		// Editing a prompt still applies while the hidden output wiring survives.
		draft.nodes[1].userPrompt = "A new prompt"
		let edited = try #require(draft.jsonBody()["nodes"] as? [[String: Any]])
		#expect(edited[1]["userPrompt"] as? String == "A new prompt")
		#expect(edited[1]["outputs"] as? [String: String] == ["summary": "object"])
	}

	@Test("row bindings survive removal, reordering, and editor dismissal")
	func bindingsSurviveCollectionChanges() {
		let store = FlowsStore()
		let first = FlowEditorNode.llm()
		let second = FlowEditorNode.tool(moduleName: "macos", toolName: "example", required: [])
		let destination = FlowEditorDestination.modal()
		var draft = FlowEditorDraft.blank()
		draft.nodes = [first, second]
		draft.destinations = [destination]
		store.editor = draft
		let editor = editorDraftBinding(Binding(get: { store.editor }, set: { store.editor = $0 }), fallback: .blank())
		let row = editor.node(first)
		let destRow = editor.destination(destination)
		store.editor?.nodes.swapAt(0, 1)
		row.wrappedValue.userPrompt = "Changed"
		#expect(store.editor?.nodes[1].userPrompt == "Changed")
		#expect(store.editor?.nodes[0].id == second.id)
		store.editor?.nodes.removeAll { $0.id == first.id }
		#expect(row.wrappedValue.id == first.id)
		row.wrappedValue.userPrompt = "Late update"
		#expect(store.editor?.nodes.count == 1)
		store.editor?.destinations.removeAll()
		#expect(destRow.wrappedValue.id == destination.id)
		destRow.wrappedValue.emailSubject = "Late update"
		#expect(store.editor?.destinations.isEmpty == true)
		store.cancelEditor()
		#expect(row.wrappedValue.id == first.id)
		row.wrappedValue.userPrompt = "After dismissal"
		#expect(destRow.wrappedValue.id == destination.id)
		destRow.wrappedValue.emailSubject = "After dismissal"
		#expect(store.editor == nil)
	}
}
