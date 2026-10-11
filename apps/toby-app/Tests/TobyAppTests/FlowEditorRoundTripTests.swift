import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Flow editor round trips")
struct FlowEditorRoundTripTests {
	@Test("replacing a step drops its stale result pointer while preserving valid pointers")
	func replacedStepResult() throws {
		let data = Data("""
		{"id":"convert","type":"tool_executor","tool":{"moduleName":"images","toolName":"imagesConvert"},"outputs":{"converted":"result"}}
		""".utf8)
		var draft = FlowEditorDraft.blank()
		draft.nodes = [FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: data))]
		draft.result = FlowResultPointer(from: "converted", path: "markdown")
		#expect((draft.jsonBody()["result"] as? [String: String])?["from"] == "converted")
		let replacement = Data("""
		{"id":"new-convert","type":"tool_executor","tool":{"moduleName":"images","toolName":"imagesConvert"}}
		""".utf8)
		draft.nodes = [FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: replacement))]
		#expect(draft.jsonBody()["result"] == nil)
		draft.result = FlowResultPointer(from: "result", path: "markdown")
		#expect((draft.jsonBody()["result"] as? [String: String])?["from"] == "result")
	}
	@Test("editor shows the AI step with its data and persona controls")
	func editorShowsAIStepControls() throws {
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
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-ai-step") }
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-persona") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Let it read") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Search jira issues") }
		#expect(throws: (any Error).self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-add-ai") }
	}

	@Test("an empty flow offers a source and an AI step, and a flow can skip either")
	func editorSupportsMissingPhases() throws {
		let store = FlowsStore()
		var draft = FlowEditorDraft.blank()
		let view = FlowEditorView(store: store, draft: .constant(draft))
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-add-step") }
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-add-ai") }
		#expect(throws: (any Error).self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-persona") }

		draft.nodes = [.llm()]
		let aiOnly = FlowEditorView(store: store, draft: .constant(draft))
		#expect(throws: Never.self) { try aiOnly.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-ai-step") }
		#expect(throws: Never.self) {
			try aiOnly.inspect().find(text: "Nothing to read yet. Add a source above to give AI some information.")
		}

		draft.nodes = [.tool(moduleName: "macos", toolName: "macWifiSetPower", required: ["enabled"])]
		let toolsOnly = FlowEditorView(store: store, draft: .constant(draft))
		#expect(throws: Never.self) { try toolsOnly.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-add-ai") }
		#expect(throws: (any Error).self) { try toolsOnly.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-ai-step") }
	}

	@Test("a new AI step reads every earlier step by default")
	func newAIStepReadsEarlierSteps() {
		let prompt = FlowEditorDraft.defaultAIPrompt(reading: [
			FlowEditorDataOption(key: "tasks", label: "Open tasks summary", detail: "Todoist"),
			FlowEditorDataOption(key: "jiraIssues", label: "Search issues", detail: "Jira"),
		])
		#expect(prompt == """
		Write a short update for me from the information below.

		Open tasks summary:
		{{json bag.tasks}}

		Search issues:
		{{json bag.jiraIssues}}
		""")
		#expect(FlowEditorDraft.defaultAIPrompt(reading: []) == "Write a short update for me.")
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

	@Test("actions after AI preserve output references and appear in the Acts phase")
	func actionsAfterAI() throws {
		let data = """
		{ "id": "notify", "type": "tool_executor",
		  "tool": { "moduleName": "macos", "toolName": "macNotificationShow" },
		  "inputs": { "title": { "const": "Reminder" }, "description": { "from": "object", "path": "markdown" } } }
		""".data(using: .utf8)!
		let action = FlowEditorNode(stored: try JSONDecoder().decode(FlowStoredNode.self, from: data))
		var draft = FlowEditorDraft.blank()
		draft.nodes = [.llm(), action]
		let view = FlowEditorView(store: FlowsStore(), draft: .constant(draft))
		#expect(throws: Never.self) { try view.inspect().find(text: "3. ACTS") }
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-add-action") }
		#expect(action.outputInputs["description"]?.from == "object")
		let inputs = try #require(action.jsonBody()["inputs"] as? [String: [String: Any]])
		#expect(inputs["description"]?["from"] as? String == "object")
		#expect(inputs["description"]?["path"] as? String == "markdown")
		var edited = action
		edited.outputInputs.removeValue(forKey: "description")
		edited.constInputs["description"] = "Fixed text"
		let fixed = try #require(edited.jsonBody()["inputs"] as? [String: [String: Any]])
		#expect(fixed["description"]?["const"] as? String == "Fixed text")
	}

	@Test("named output fields and action conditions survive editing")
	func structuredDecisionsRoundTrip() throws {
		let data = """
		{
		  "id": "flow.reminder", "name": "Meeting reminder", "nodes": [
		    { "id": "think", "type": "llm_prompter",
		      "schema": { "kind": "object", "fields": {
		        "shouldNotify": { "type": "boolean", "description": "Whether a meeting is coming" },
		        "title": { "type": "string" }, "description": { "type": "string" }
		      } }, "systemPrompt": "Decide", "userPrompt": "Look at events", "outputs": { "decision": "object" } },
		    { "id": "notify", "type": "tool_executor", "tool": { "moduleName": "macos", "toolName": "macNotificationShow" },
		      "when": { "from": "decision", "path": "shouldNotify" },
		      "inputs": { "title": { "from": "decision", "path": "title" }, "description": { "from": "decision", "path": "description" } } }
		  ], "result": { "from": "decision" }, "destinations": [{ "type": "modal" }]
		}
		""".data(using: .utf8)!
		var draft = FlowEditorDraft.from(document: try JSONDecoder().decode(FlowDocumentPayload.self, from: data))
		#expect(draft.outputValidationError == nil)
		#expect(draft.nodes[0].outputFields.count == 3)
		#expect(draft.nodes[1].when == FlowEditorOutputInput(from: "decision", path: "shouldNotify"))
		#expect(draft.promptOutputs(before: "notify").first?.booleanPath == "shouldNotify")
		let original = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
		let saved = try #require(draft.jsonBody()["nodes"] as? NSArray)
		#expect(saved.isEqual(original["nodes"]))
		let aiControls = FlowEditorOutputControls(node: .constant(draft.nodes[0]))
		#expect(throws: Never.self) { try aiControls.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-answer-format") }
		#expect(throws: Never.self) { try aiControls.inspect().find(text: "AI must return every field. Use a boolean field to decide whether a later action runs.") }
		let conditions = FlowEditorConditionControls(node: .constant(draft.nodes[1]), previousOutputs: draft.promptOutputs(before: "notify"))
		#expect(throws: Never.self) { try conditions.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-condition-notify") }
		#expect(throws: Never.self) { try conditions.inspect().find(text: "Runs when the value is true; skips when false. A missing value or another type stops the flow.") }
		draft.nodes[1].when = nil
		let edited = try #require(draft.jsonBody()["nodes"] as? [[String: Any]])
		#expect(edited[1]["when"] == nil)
	}

	@Test("converting markdown to named fields keeps the shared result usable")
	func convertsSharedMarkdownResult() {
		var ai = FlowEditorNode.llm()
		ai.outputKind = "object"
		ai.outputFields = [FlowEditorOutputField(name: "shouldRun", type: "boolean"), FlowEditorOutputField(name: "text", type: "string")]
		var draft = FlowEditorDraft.blank()
		draft.nodes = [ai]
		draft.result = FlowResultPointer(from: "object", path: "markdown")
		draft.adaptResultForNamedFields(nodeId: ai.id)
		#expect(draft.result == FlowResultPointer(from: "object", path: nil))
		// Custom field pointers continue to name the selected field.
		draft.result = FlowResultPointer(from: "object", path: "text")
		draft.adaptResultForNamedFields(nodeId: ai.id)
		#expect(draft.result?.path == "text")
	}

	@Test("structured output validation rejects duplicate and unsafe names")
	func validatesStructuredFields() {
		var node = FlowEditorNode.llm()
		node.outputKind = "object"
		#expect(node.outputValidationError != nil)
		node.outputFields = [FlowEditorOutputField(name: "shouldRun", type: "boolean")]
		#expect(node.outputValidationError == nil)
		node.outputFields.append(FlowEditorOutputField(name: "shouldRun", type: "string"))
		#expect(node.outputValidationError == "Each output field needs a unique name.")
		node.outputFields = [FlowEditorOutputField(name: "constructor", type: "string")]
		#expect(node.outputValidationError != nil)
		node.outputFields = [FlowEditorOutputField(name: "with spaces", type: "string")]
		#expect(node.outputValidationError != nil)
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
