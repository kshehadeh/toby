import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("Toby Todos Flow tools")
struct TodoFlowToolsTests {
	@Test("built-in tools appear without a connection and save their core reference")
	func catalogAndDraft() throws {
		let data = Data(#"""
		{"modules":[{"name":"tobyTodos","displayName":"Toby Todos","connected":true,"tools":[
		  {"coreTool":"todos.create","moduleName":"tobyTodos","toolName":"todos.create","displayName":"Create todo","readOnly":false,
		   "inputSchema":{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}}
		]}]}
		"""#.utf8)
		let catalog = try FlowToolCatalog.parse(data)
		let tool = try #require(catalog.modules.first?.tools.first)
		let sections = FlowToolPickerModel.sections(scriptTools: [], modules: catalog.modules, query: "todo")
		#expect(sections.count == 1)
		#expect(sections[0].title == "Toby Todos")
		#expect(sections[0].rows[0].systemImage == "plus.circle")
		var node = FlowEditorNode.tool(tool)
		node.constInputs["title"] = "From Flow"
		#expect(node.jsonBody()["tool"] as? [String: String] == ["coreTool": "todos.create"])
	}

	@Test("saved core references survive reload and further edits")
	func reloadDraft() throws {
		let data = Data(#"""
		{"id":"create","type":"tool_executor","tool":{"coreTool":"todos.create"},"inputs":{"title":{"const":"Original"}}}
		"""#.utf8)
		let stored = try JSONDecoder().decode(FlowStoredNode.self, from: data)
		#expect(stored.tool?.coreTool == "todos.create")
		var draft = FlowEditorNode(stored: stored)
		draft.constInputs["title"] = "Edited"
		#expect(draft.moduleName == "tobyTodos")
		#expect(draft.toolName == "todos.create")
		#expect(draft.jsonBody()["tool"] as? [String: String] == ["coreTool": "todos.create"])
		let reference = try JSONDecoder().decode(FlowToolRef.self, from: Data(#"{"coreTool":"todos.complete"}"#.utf8))
		#expect(reference.displayLabel == "todos.complete")
	}
}
