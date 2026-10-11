import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Flow step fields")
struct FlowStepFieldsTests {
	private static let convertSchema: [String: Any] = [
		"type": "object",
		"required": ["source"],
		"properties": [
			"source": ["type": "string", "description": "Image path. Never a URL."],
			"format": ["type": ["string", "null"], "enum": ["jpeg", "png", "webp", NSNull()], "description": "Output format; defaults to input format."],
			"quality": ["type": ["integer", "null"], "minimum": 1, "maximum": 100, "default": 85, "description": "Encoding quality."],
			"lossless": ["type": ["boolean", "null"], "default": false],
			"outputName": ["type": ["string", "null"]],
			"rotate": ["type": "integer", "enum": [0, 90, 180, 270]],
			"width": ["type": "integer", "minimum": 1, "maximum": 40_000_000],
		],
	]

	private static func convertTool() -> FlowCatalogTool {
		FlowCatalogTool(
			moduleName: "images",
			toolName: "imagesConvert",
			displayName: "Convert image",
			description: "Convert a still image.",
			readOnly: false,
			standardTool: nil,
			inputSchema: FlowInputSchema.parse(convertSchema)
		)
	}

	@Test("schema hints survive both parsing paths")
	func schemaHints() throws {
		let parsed = FlowInputSchema.parse(Self.convertSchema).properties ?? [:]
		let data = try JSONSerialization.data(withJSONObject: Self.convertSchema)
		let decoded = try JSONDecoder().decode(FlowInputSchema.self, from: data).properties ?? [:]
		for properties in [parsed, decoded] {
			#expect(properties["format"]?.type == "string")
			#expect(properties["format"]?.enumValues == ["jpeg", "png", "webp"])
			#expect(properties["quality"]?.defaultValue == "85")
			#expect(properties["quality"]?.minimum == 1)
			#expect(properties["quality"]?.maximum == 100)
			#expect(properties["lossless"]?.type == "boolean")
			#expect(properties["lossless"]?.defaultValue == "false")
			#expect(properties["rotate"]?.enumValues == ["0", "90", "180", "270"])
		}
	}

	@Test("inputs pick a control from their schema")
	func inputKinds() throws {
		let specs = FlowStepInputLayout.specs(catalogTool: Self.convertTool(), scriptTool: nil)
		#expect(specs.first?.key == "source")
		#expect(specs.first?.isRequired == true)
		let byKey = Dictionary(uniqueKeysWithValues: specs.map { ($0.key, $0) })
		let format = try #require(byKey["format"])
		#expect(format.kind == .choice([
			.init(value: "jpeg", label: "JPEG"),
			.init(value: "png", label: "PNG"),
			.init(value: "webp", label: "WebP"),
		]))
		#expect(byKey["lossless"]?.kind == .toggle)
		#expect(byKey["quality"]?.kind == .number)
		#expect(byKey["quality"]?.placeholder == "85")
		#expect(byKey["quality"]?.rangeHint == "1 to 100")
		#expect(byKey["width"]?.rangeHint == nil)
		#expect(byKey["source"]?.placeholder == "Required")
		#expect(byKey["outputName"]?.placeholder == "Optional")
		#expect(byKey["outputName"]?.label == "Output name")
		#expect(byKey["rotate"]?.choiceLabel(for: "90") == "90")
	}

	@Test("only required and filled-in inputs show before More options")
	func primaryInputs() {
		let specs = FlowStepInputLayout.specs(catalogTool: Self.convertTool(), scriptTool: nil)
		var node = FlowEditorNode.tool(moduleName: "images", toolName: "imagesConvert", required: ["source"])
		node.triggerInputs["source"] = FlowTriggerValues.filePath
		node.constInputs["format"] = "jpeg"
		node.constInputs["outputName"] = "   "
		#expect(FlowStepInputLayout.primaryKeys(specs: specs, node: node, pinned: []) == ["source", "format"])
		#expect(FlowStepInputLayout.primaryKeys(specs: specs, node: node, pinned: ["quality"]) == ["source", "format", "quality"])
		let hidden = specs.filter { !["source", "format"].contains($0.key) }
		#expect(FlowStepInputLayout.hiddenHint(hidden) == "Lossless, Output name, Quality +2")
	}

	@Test("a collapsed step summarizes its values in plain words")
	func summary() {
		let specs = FlowStepInputLayout.specs(catalogTool: Self.convertTool(), scriptTool: nil)
		var trigger = FlowTriggerSpec.manual()
		trigger.changeSource("macos.fileChanges")
		trigger.source.runPerFile = true
		let values = FlowTriggerValues.values(for: [trigger])
		var node = FlowEditorNode.tool(moduleName: "images", toolName: "imagesConvert", required: ["source"])
		node.triggerInputs["source"] = FlowTriggerValues.filePath
		node.constInputs["format"] = "jpeg"
		node.constInputs["quality"] = "85"
		node.constInputs["lossless"] = "true"
		#expect(
			FlowStepInputLayout.summary(specs: specs, node: node, triggerValues: values, outputs: [])
				== "Source: The new file · Format: JPEG · Lossless: On +1"
		)
		node.triggerInputs.removeAll()
		node.outputInputs["source"] = FlowEditorOutputInput(from: "object", path: "markdown")
		let outputs = [FlowStepOutputOption(key: "object", title: "AI answer", textPath: "markdown", systemImage: "sparkles")]
		let linked = FlowStepInputLayout.summary(specs: specs, node: node, triggerValues: values, outputs: outputs)
		#expect(linked?.hasPrefix("Source: AI answer") == true)
	}

	@Test("trigger values are named for what the trigger hands over")
	func triggerValues() {
		var files = FlowTriggerSpec.manual()
		files.changeSource("macos.fileChanges")
		files.source.runPerFile = true
		#expect(FlowTriggerValues.values(for: [files]).map(\.label) == [
			"The new file", "All changed files", "The watched folder", "When it happened",
		])
		files.source.runPerFile = false
		files.source.kinds = ["new", "changed"]
		#expect(FlowTriggerValues.values(for: [files]).first?.label == "The first changed file")
		#expect(FlowTriggerValues.values(for: [.manual()]).isEmpty)
	}

	@Test("the link menu and More options appear on a step's inputs")
	func inputsView() throws {
		var node = FlowEditorNode.tool(moduleName: "images", toolName: "imagesConvert", required: ["source"])
		node.triggerInputs["source"] = FlowTriggerValues.filePath
		var trigger = FlowTriggerSpec.manual()
		trigger.changeSource("macos.fileChanges")
		let view = FlowEditorStepInputs(
			node: .constant(node),
			specs: FlowStepInputLayout.specs(catalogTool: Self.convertTool(), scriptTool: nil),
			triggerValues: FlowTriggerValues.values(for: [trigger]),
			outputs: []
		)
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-input-source") }
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-link-source") }
		#expect(throws: Never.self) { try view.inspect().find(text: "The first new file") }
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-more-options-\(node.id)") }
		#expect(throws: (any Error).self) { try view.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-input-quality") }
	}

	@Test("conditions only show once a step has one")
	func conditionVisibility() throws {
		var node = FlowEditorNode.tool(moduleName: "macos", toolName: "macNotificationShow", required: [])
		node.id = "notify"
		let outputs = [FlowPromptOutput(key: "decision", stepId: "think", booleanPath: "shouldNotify")]
		let hidden = FlowEditorConditionControls(node: .constant(node), previousOutputs: outputs)
		#expect(throws: (any Error).self) { try hidden.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-condition-notify") }
		node.when = FlowEditorConditionControls.defaultCondition(outputs)
		#expect(node.when == FlowEditorOutputInput(from: "decision", path: "shouldNotify"))
		let shown = FlowEditorConditionControls(node: .constant(node), previousOutputs: outputs)
		#expect(throws: Never.self) { try shown.inspect().find(viewWithAccessibilityIdentifier: "flow-editor-condition-notify") }
		#expect(FlowEditorConditionControls.defaultCondition([]) == nil)
	}
}
