import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("User Script Tools")
struct UserScriptToolsTests {
	@Test("new tool action is available from an empty library")
	func createsFirstTool() throws {
		let store = UserScriptToolsStore()
		let view = UserScriptToolsView(store: store)
		let newTool = try view.inspect().find(viewWithAccessibilityIdentifier: "script-tool-new").button()
		try newTool.tap()
		#expect(store.draft != nil)
		#expect(store.draft?.id == nil)
	}

	@Test("script editor exposes a visible Save Tool action once named")
	func editorHasSaveAction() throws {
		let store = UserScriptToolsStore()
		store.create()
		let empty = UserScriptToolsView(store: store)
		let disabledSave = try empty.inspect().find(viewWithAccessibilityIdentifier: "script-tool-save").button()
		#expect(disabledSave.isDisabled())
		store.draft?.name = "Example"
		let named = UserScriptToolsView(store: store)
		let enabledSave = try named.inspect().find(viewWithAccessibilityIdentifier: "script-tool-save").button()
		#expect(!enabledSave.isDisabled())
	}

	@Test("flow steps keep a stable script ID and its declared inputs")
	func flowStepReferencesSharedTool() {
		let tool = UserScriptTool(
			id: "tool.shared", name: "Shared", description: "", language: "typescript",
			inputNames: ["value"], outputKind: "json", currentRevision: 2,
			source: "export default async function run(input) { return input; }",
			usedBy: []
		)
		let node = FlowEditorNode.userTool(tool)
		#expect(node.userToolId == "tool.shared")
		#expect(node.constInputs["value"] == "")
		let body = node.jsonBody()
		let ref = body["tool"] as? [String: String]
		#expect(ref?["userToolId"] == "tool.shared")
	}

	@Test("draft validates input names before saving")
	func validatesNames() {
		var draft = UserScriptToolDraft()
		draft.name = "Example"
		draft.inputs = [ScriptInputDraft(name: "first"), ScriptInputDraft(name: "second")]
		#expect(draft.isValid)
		#expect(draft.names == ["first", "second"])
		draft.inputs[1].name = "first"
		#expect(!draft.isValid)
	}

	@Test("test values use the declared input names")
	func testInputsAreNamed() {
		let store = UserScriptToolsStore()
		store.create()
		store.draft?.inputs = [ScriptInputDraft(name: "first"), ScriptInputDraft(name: "second")]
		store.testValues = ["first": "hello", "second": "world"]
		#expect(store.testInputObject == ["first": "hello", "second": "world"])
		store.draft?.inputs[0].name = " first "
		#expect(store.testInputObject == ["first": "hello", "second": "world"])
	}

	@Test("a new or edited tool can run a test before saving")
	func testButtonUsesCurrentDraft() throws {
		let store = UserScriptToolsStore()
		store.create()
		let newTool = UserScriptToolsView(store: store)
		let newToolTest = try newTool.inspect().find(viewWithAccessibilityIdentifier: "script-tool-run-test").button()
		#expect(!newToolTest.isDisabled())
		store.draft?.name = "Changed"
		let unsaved = UserScriptToolsView(store: store)
		let unsavedTest = try unsaved.inspect().find(viewWithAccessibilityIdentifier: "script-tool-run-test").button()
		#expect(store.isDirty)
		#expect(!unsavedTest.isDisabled())
		store.testOutput = "Previous result"
		store.draft?.source = ""
		#expect(store.testOutput == nil)
		let emptyCode = UserScriptToolsView(store: store)
		let emptyCodeTest = try emptyCode.inspect().find(viewWithAccessibilityIdentifier: "script-tool-run-test").button()
		#expect(emptyCodeTest.isDisabled())
	}

	@Test("adding an input requires a valid name before save")
	func addInputRow() throws {
		let store = UserScriptToolsStore()
		store.create()
		store.draft?.name = "Example"
		let view = UserScriptToolsView(store: store)
		let addInput = try view.inspect().find(viewWithAccessibilityIdentifier: "script-tool-add-input").button()
		try addInput.tap()
		#expect(store.draft?.inputs.count == 1)
		#expect(store.draft?.isValid == false)
		store.draft?.inputs[0].name = "customer"
		#expect(store.draft?.isValid == true)
	}

	@Test("generated code supports follow-up edits in the current editor draft")
	func generatedCodeReplacesDraft() throws {
		let store = UserScriptToolsStore()
		store.create()
		let view = UserScriptToolsView(store: store)
		let generate = try view.inspect().find(viewWithAccessibilityIdentifier: "script-tool-generate-code").button()
		#expect(!generate.isDisabled())
		let original = try #require(store.draft)
		let session = store.editorSessionId
		#expect(store.applyGeneratedSource("export default () => 'Generated'", instruction: "Generate a greeting", to: original, in: session))
		#expect(store.draft?.source == "export default () => 'Generated'")
		#expect(store.generationRequests == ["Generate a greeting"])
		#expect(store.editorSessionId != session)
		#expect(!store.applyGeneratedSource("stale", instruction: "Stale request", to: original, in: session))
		#expect(store.draft?.source == "export default () => 'Generated'")
		#expect(store.generationRequests == ["Generate a greeting"])
		let followUp = try #require(store.draft)
		let followUpSession = store.editorSessionId
		#expect(store.applyGeneratedSource("export default () => 'Generated!'", instruction: "Add an exclamation mark", to: followUp, in: followUpSession))
		#expect(store.draft?.source == "export default () => 'Generated!'")
		#expect(store.generationContext == ["Generate a greeting", "Add an exclamation mark"])
		store.create()
		#expect(store.generationRequests.isEmpty)
	}
}
