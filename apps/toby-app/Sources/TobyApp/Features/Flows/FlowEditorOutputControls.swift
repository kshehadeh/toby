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

/// "Only runs when <output> <field> is true", shown once a step has a
/// condition. Adding and removing it lives in the step's ••• menu.
struct FlowEditorConditionControls: View {
	@Binding var node: FlowEditorNode
	let previousOutputs: [FlowPromptOutput]

	/// The first earlier output with a yes/no field, else the latest output.
	static func defaultCondition(_ previousOutputs: [FlowPromptOutput]) -> FlowEditorOutputInput? {
		guard let output = previousOutputs.first(where: { $0.booleanPath != nil }) ?? previousOutputs.last else { return nil }
		return FlowEditorOutputInput(from: output.key, path: output.booleanPath)
	}

	var body: some View {
		if let condition = node.when {
			VStack(alignment: .leading, spacing: 6) {
				HStack(spacing: 8) {
					Image(systemName: "arrow.triangle.branch")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(AppTheme.secondaryText)
						.accessibilityHidden(true)
					Text("Only runs when")
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowTitle)
					Picker("Condition output", selection: Binding(
						get: { node.when?.from ?? "" },
						set: { key in node.when = FlowEditorOutputInput(from: key, path: previousOutputs.first(where: { $0.key == key })?.booleanPath) }
					)) {
						if !previousOutputs.contains(where: { $0.key == condition.from }) { Text(condition.from).tag(condition.from) }
						ForEach(previousOutputs) { output in Text(output.key).tag(output.key) }
					}
					.labelsHidden()
					.pickerStyle(.menu)
					.fixedSize()
					TextField("Yes/no field", text: Binding(
						get: { node.when?.path ?? "" },
						set: { node.when = FlowEditorOutputInput(from: node.when?.from ?? "", path: $0.isEmpty ? nil : $0) }
					))
					.textFieldStyle(.roundedBorder)
					.font(.system(size: 11, design: .monospaced))
					.frame(maxWidth: 160)
					.accessibilityLabel("Condition field")
					Text("is true")
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowTitle)
					Spacer(minLength: 0)
					Button {
						node.when = nil
					} label: {
						Image(systemName: "xmark")
							.font(.system(size: 9, weight: .bold))
							.foregroundStyle(AppTheme.secondaryText)
							.frame(width: 20, height: 20)
							.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
					.accessibilityLabel("Remove condition")
				}
				Text("Skips this step when the value is false. A missing value stops the flow.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			.padding(10)
			.background(
				RoundedRectangle(cornerRadius: 8, style: .continuous)
					.fill(AppTheme.primaryText.opacity(0.035))
			)
			.accessibilityElement(children: .contain)
			.accessibilityIdentifier("flow-editor-condition-\(node.id)")
		}
	}
}
