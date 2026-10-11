import SwiftUI

struct FlowEditorOutputControls: View {
	@Binding var node: FlowEditorNode
	var onFormatChange: () -> Void = {}

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Picker("Answer format", selection: Binding(
				get: { node.outputKind },
				set: { kind in
					node.outputKind = kind
					if kind == "object", node.outputFields.isEmpty {
						node.outputFields = [
							FlowEditorOutputField(name: "shouldRun", type: "boolean", description: "Whether the action should run"),
							FlowEditorOutputField(name: "text", type: "string", description: "Text for the action"),
						]
					}
					if kind == "object", node.systemPrompt == "Reply with markdown only." {
						node.systemPrompt = "Return the requested fields with the exact types."
					} else if kind == "markdown", node.systemPrompt == "Return the requested fields with the exact types." {
						node.systemPrompt = "Reply with markdown only."
					}
					onFormatChange()
				}
			)) {
				Text("Markdown text").tag("markdown")
				Text("Named fields").tag("object")
			}.pickerStyle(.menu).accessibilityIdentifier("flow-editor-answer-format")

			if node.outputKind == "object" {
				Text("AI must return every field. Use a boolean field to decide whether a later action runs.")
					.font(.caption).foregroundStyle(AppTheme.secondaryText)
				ForEach($node.outputFields) { $field in
					VStack(alignment: .leading, spacing: 6) {
						HStack {
							TextField("Field name", text: $field.name).textFieldStyle(.roundedBorder)
							Picker("Type for \(field.name)", selection: $field.type) {
								Text("Text").tag("string")
								Text("Boolean").tag("boolean")
								Text("Number").tag("number")
							}.pickerStyle(.menu)
							Button("Remove field", systemImage: "minus.circle", role: .destructive) {
								node.outputFields.removeAll { $0.id == field.id }
							}.labelStyle(.iconOnly).buttonStyle(.plain)
						}
						TextField("What this field means (optional)", text: $field.description)
							.textFieldStyle(.roundedBorder)
					}
				}
				Button("Add field", systemImage: "plus") {
					node.outputFields.append(FlowEditorOutputField(name: "", type: "string"))
				}.disabled(node.outputFields.count >= 32)
				if let error = node.outputValidationError {
					InlineStatusMessage(message: error, tone: .error)
				}
			}
		}.accessibilityIdentifier("flow-editor-output-fields")
	}
}

struct FlowEditorConditionControls: View {
	@Binding var node: FlowEditorNode
	let previousOutputs: [FlowPromptOutput]

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			Toggle("Run only when", isOn: Binding(
				get: { node.when != nil },
				set: { enabled in
					let output = previousOutputs.first(where: { $0.booleanPath != nil }) ?? previousOutputs.last
					node.when = enabled ? FlowEditorOutputInput(from: output?.key ?? "", path: output?.booleanPath) : nil
				}
			)).disabled(previousOutputs.isEmpty && node.when == nil)
				.accessibilityIdentifier("flow-editor-condition-\(node.id)")
				.help("Choose a boolean output from an earlier step. Add a step first if none is available.")
			if let condition = node.when {
				Picker("Condition output", selection: Binding(
					get: { node.when?.from ?? "" },
					set: { key in node.when = FlowEditorOutputInput(from: key, path: previousOutputs.first(where: { $0.key == key })?.booleanPath) }
				)) {
					if !previousOutputs.contains(where: { $0.key == condition.from }) { Text(condition.from).tag(condition.from) }
					ForEach(previousOutputs) { output in Text(output.key).tag(output.key) }
				}.pickerStyle(.menu)
				TextField("Boolean field path", text: Binding(
					get: { node.when?.path ?? "" },
					set: { node.when = FlowEditorOutputInput(from: node.when?.from ?? "", path: $0.isEmpty ? nil : $0) }
				)).textFieldStyle(.roundedBorder)
				Text("Runs when the value is true; skips when false. A missing value or another type stops the flow.")
					.font(.caption).foregroundStyle(AppTheme.secondaryText)
			}
		}
	}
}
