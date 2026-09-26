import SwiftUI

struct UserScriptToolsView: View {
	@Bindable var store: UserScriptToolsStore
	@Environment(\.dismiss) private var dismiss
	@State private var pendingSelection: UserScriptTool?
	@State private var pendingNew = false
	@State private var pendingDone = false
	@State private var showDiscard = false
	@State private var showGenerationPrompt = false
	@State private var generationPrompt = ""

	var body: some View {
		NavigationStack {
			HStack(spacing: 0) {
				library.frame(width: 235)
				Divider()
				if store.draft != nil {
					editor
				} else {
					FeatureBrowserPlaceholder(
						systemImage: "curlybraces",
						title: "No script tool selected",
						prompt: "Select a script tool",
						onCreate: requestNewTool
					)
				}
			}
			.navigationTitle("Script Tools")
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Done") {
						if store.isDirty { pendingDone = true; showDiscard = true }
						else { dismiss() }
					}
				}
				ToolbarItem(placement: .confirmationAction) {
					Button("Save Tool") { Task { await store.save() } }
						.disabled(store.draft?.isValid != true || store.isSaving)
						.keyboardShortcut(.defaultAction)
						.accessibilityIdentifier("script-tool-save")
				}
			}
			.task { await store.load() }
			.onChange(of: store.editorSessionId) { _, _ in generationPrompt = "" }
			.interactiveDismissDisabled(store.isDirty)
			.confirmationDialog("Discard unsaved changes?", isPresented: $showDiscard) {
				Button("Discard Changes", role: .destructive) {
					store.cancel()
					if pendingDone { dismiss() }
					else if pendingNew { store.create() }
					else if let pendingSelection { store.edit(pendingSelection) }
					pendingDone = false
					pendingNew = false
					pendingSelection = nil
				}
				Button("Keep Editing", role: .cancel) {
					pendingDone = false
					pendingNew = false
					pendingSelection = nil
				}
			}
			.confirmationDialog("Delete this tool?", isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } }
			)) {
				Button("Delete", role: .destructive) {
					if let tool = store.pendingDelete { Task { await store.delete(tool) } }
				}
				Button("Cancel", role: .cancel) { store.pendingDelete = nil }
			} message: {
				Text("This removes the tool and its source revisions.")
			}
		}
		.frame(minWidth: 1000, minHeight: 740)
	}

	private var library: some View {
		VStack(spacing: 0) {
			Button(action: requestNewTool) {
				Label("New Tool", systemImage: "plus")
			}
			.buttonStyle(.plain)
			.padding(12)
			.frame(maxWidth: .infinity, alignment: .leading)
			.accessibilityIdentifier("script-tool-new")
			Divider()
			FeatureBrowserList(
				isLoading: store.isLoading,
				isEmpty: store.tools.isEmpty,
				loadingText: "Loading script tools…",
				emptyText: "No script tools"
			) {
				ForEach(store.tools) { tool in
					Button {
						if store.isDirty {
							pendingSelection = tool
							showDiscard = true
						} else { store.edit(tool) }
					} label: {
						FeatureBrowserRow(
							title: tool.name,
							subtitle: "\(tool.language == "typescript" ? "TypeScript" : "AppleScript") · \(flowCountDescription(tool.usedBy.count))",
							isSelected: store.draft?.id == tool.id,
							accessibilityIdentifier: "script-tool-row-\(tool.id)"
						) {
							FeatureBrowserRowGlyph(
								systemImage: "curlybraces",
								isSelected: store.draft?.id == tool.id
							)
						}
					}
					.buttonStyle(.plain)
					.contextMenu {
						Button("Delete", role: .destructive) { store.pendingDelete = tool }
							.disabled(!tool.usedBy.isEmpty)
					}
				}
			}
		}
	}

	private func requestNewTool() {
		if store.isDirty { pendingNew = true; showDiscard = true }
		else { store.create() }
	}

	private func flowCountDescription(_ count: Int) -> String {
		"\(count) \(count == 1 ? "flow" : "flows")"
	}

	private var editor: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if let error = store.error {
					InlineStatusMessage(message: error, tone: .error, font: .caption)
				}
				detailsCard
				inputsEditor
				codeEditor
				testEditor
				metadata
				SetupTipCard(
					tipId: "script-tool-permissions",
					title: "Script permissions",
					message: "Scripts run with your macOS user permissions. Review code before saving and testing it.",
					accessibilityId: "script-tool-permissions-tip"
				)
			}
			.padding(20)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	/// Name / description / language / output — grouped into the same
	/// `SettingsCard` + `SettingsRow` chrome every other settings screen uses,
	/// instead of a bare `HStack` of raw controls.
	private var detailsCard: some View {
		VStack(alignment: .leading, spacing: 8) {
			SettingsSectionHeader(title: "Details")
			SettingsCard {
				SettingsRow(title: "Name") {
					SettingsInlineField(
						text: Binding(
							get: { store.draft?.name ?? "" }, set: { store.draft?.name = $0 }
						),
						placeholder: "Tool name",
						minWidth: 200,
						maxWidth: 260
					)
					.accessibilityIdentifier("script-tool-name")
				}
				SettingsRow(title: "Description") {
					TextField("Shown in the tool picker", text: Binding(
						get: { store.draft?.description ?? "" }, set: { store.draft?.description = $0 }
					), axis: .vertical)
					.lineLimit(2...5)
					.textFieldStyle(.roundedBorder)
					.frame(minWidth: 220, maxWidth: 320)
					.accessibilityIdentifier("script-tool-description")
				}
				SettingsRow(title: "Language") {
					SettingsSelectChoiceField(
						title: "Language",
						choices: [
							SettingsSelectChoice(value: "typescript", label: "TypeScript"),
							SettingsSelectChoice(value: "applescript", label: "AppleScript")
						],
						selection: Binding(
							get: { store.draft?.language ?? "typescript" },
							set: { value in
								store.draft?.language = value
								if store.draft?.id == nil {
									store.draft?.source = value == "typescript"
										? "export default async function run(input: Record<string, unknown>) {\n  return \"Hello from Toby\";\n}"
										: "on run argv\n  return \"Hello from Toby\"\nend run"
								}
							}
						),
						minWidth: 150,
						maxWidth: 200
					)
				}
				SettingsRow(title: "Output", showsDivider: false) {
					SettingsSelectChoiceField(
						title: "Output",
						choices: [
							SettingsSelectChoice(value: "text", label: "Text"),
							SettingsSelectChoice(value: "json", label: "JSON")
						],
						selection: Binding(
							get: { store.draft?.outputKind ?? "text" }, set: { store.draft?.outputKind = $0 }
						),
						minWidth: 150,
						maxWidth: 200
					)
				}
			}
		}
	}

	private var inputsEditor: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				SettingsSectionHeader(title: "Inputs")
				Spacer()
				Button("Add Input", systemImage: "plus") {
					store.draft?.inputs.append(ScriptInputDraft(name: ""))
				}
				.accessibilityIdentifier("script-tool-add-input")
			}
			let inputs = store.draft?.inputs ?? []
			SettingsCard {
				if inputs.isEmpty {
					Text("No inputs yet. Add one to pass data into this tool when a flow calls it.")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
						.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
						.frame(maxWidth: .infinity, alignment: .leading)
				} else {
					ForEach(Array(inputs.enumerated()), id: \.element.id) { index, input in
						SettingsRow(
							title: "Input \(index + 1)",
							description: store.draft?.language == "typescript"
								? "input.\(input.name.isEmpty ? "…" : input.name)"
								: "argv[\(index)]",
							showsDivider: index < inputs.count - 1
						) {
							HStack(spacing: 8) {
								SettingsInlineField(
									text: inputNameBinding(input.id),
									placeholder: "Input name",
									minWidth: 130,
									maxWidth: 170
								)
								.accessibilityIdentifier("script-tool-input-\(input.id)")
								Button {
									store.draft?.inputs.removeAll { $0.id == input.id }
								} label: {
									Image(systemName: "minus.circle")
								}
								.buttonStyle(.borderless)
								.accessibilityLabel("Remove input \(input.name)")
							}
						}
					}
				}
			}
			if let draft = store.draft, !draft.inputs.isEmpty, !draft.areInputNamesValid {
				Text("Use unique names beginning with a letter or underscore.")
					.font(.caption)
					.foregroundStyle(.red)
			}
		}
	}

	private func inputNameBinding(_ id: UUID) -> Binding<String> {
		Binding(
			get: { store.draft?.inputs.first(where: { $0.id == id })?.name ?? "" },
			set: { value in
				guard let index = store.draft?.inputs.firstIndex(where: { $0.id == id }) else { return }
				store.draft?.inputs[index].name = value
			}
		)
	}

	/// The code surface: a small header strip carrying the language `Badge`
	/// sits on `tobyLogBackground` above the real syntax-highlighted editor,
	/// so this is visibly a *code* well rather than another settings card.
	private var codeEditor: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				SettingsSectionHeader(title: "Code")
				Spacer()
				if store.isGeneratingCode {
					ProgressView().controlSize(.small)
					Text("Generating…").font(.caption).foregroundStyle(.secondary)
				}
				Button("Edit with AI", systemImage: "sparkles") {
					showGenerationPrompt = true
				}
				.accessibilityIdentifier("script-tool-generate-code")
				.popover(isPresented: $showGenerationPrompt) {
					generationPromptView
				}
				Image(systemName: "info.circle")
					.foregroundStyle(.secondary)
					.help(store.draft?.language == "typescript"
						? "Export a default async function. Named inputs are properties of its input object."
						: "Use on run argv. Named inputs arrive as strings in the listed order; return JSON text for JSON output.")
					.accessibilityLabel("Code format help")
			}
			if let error = store.generationError {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
			VStack(spacing: 0) {
				HStack {
					Badge(
						text: store.draft?.language == "typescript" ? "TS" : "AppleScript",
						tone: .accentSoft
					)
					Spacer()
				}
				.padding(.horizontal, 12)
				.frame(height: 34)
				.background(Color(nsColor: .tobyLogCodeBackground))
				ScriptCodeEditor(
					source: Binding(
						get: { store.draft?.source ?? "" }, set: { store.draft?.source = $0 }
					),
					language: store.draft?.language ?? "typescript"
				)
				.id("\(store.editorSessionId)-\(store.draft?.language ?? "typescript")")
				.frame(height: 300)
			}
			.background(Color(nsColor: .tobyLogBackground))
			.clipShape(.rect(cornerRadius: SettingsDesign.controlCornerRadius))
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.stroke(SettingsDesign.controlBorder)
			}
		}
	}

	private var generationPromptView: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("Code assistant")
				.font(.headline)
			Text("Describe what to build or change. Toby uses the current \(store.draft?.language == "applescript" ? "AppleScript" : "TypeScript") code, tool settings, and earlier requests.")
				.font(.subheadline)
				.foregroundStyle(.secondary)
			if !store.generationRequests.isEmpty {
				ScrollView {
					VStack(alignment: .leading, spacing: 12) {
						ForEach(Array(store.generationRequests.enumerated()), id: \.offset) { index, request in
							HStack(alignment: .top, spacing: 8) {
								Image(systemName: "checkmark.circle.fill")
									.foregroundStyle(.secondary)
									.accessibilityHidden(true)
								VStack(alignment: .leading, spacing: 3) {
									Text("Request \(index + 1) · Applied to editor")
										.font(.caption)
										.foregroundStyle(.secondary)
									Text(request)
										.font(.subheadline)
										.textSelection(.enabled)
								}
							}
						}
					}
				}
				.frame(maxHeight: 200)
				.accessibilityIdentifier("script-tool-generation-history")
			}
			if let error = store.generationError {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
			TextField(store.generationRequests.isEmpty ? "Describe the script" : "What should change next?", text: $generationPrompt, axis: .vertical)
				.lineLimit(3...7)
				.disabled(store.isGeneratingCode)
				.accessibilityIdentifier("script-tool-generation-prompt")
			if generationPrompt.utf16.count > 4_000 {
				Text("Keep the request under 4,000 characters.")
					.font(.caption)
					.foregroundStyle(.red)
			}
			HStack {
				if store.isGeneratingCode {
					ProgressView().controlSize(.small)
					Text("Updating code…").font(.caption).foregroundStyle(.secondary)
				}
				Spacer()
				Button("Close") { showGenerationPrompt = false }
				Button(store.generationRequests.isEmpty ? "Generate" : "Update code") {
					let instruction = generationPrompt
					Task { await store.generateCode(instruction: instruction) }
				}
				.disabled(store.isGeneratingCode || generationPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || generationPrompt.utf16.count > 4_000)
				.accessibilityIdentifier("script-tool-submit-generation")
			}
		}
		.padding(16)
		.frame(width: 440)
	}

	private var testEditor: some View {
		VStack(alignment: .leading, spacing: 8) {
			SettingsSectionHeader(title: "Test")
			HStack(alignment: .bottom, spacing: 12) {
				VStack(alignment: .leading, spacing: 6) {
					if let inputs = store.draft?.inputs, !inputs.isEmpty {
						ForEach(inputs) { input in
							let name = input.name.trimmingCharacters(in: .whitespacesAndNewlines)
							HStack(spacing: 8) {
								Text(name).frame(width: 110, alignment: .leading)
								TextField("Value", text: Binding(
									get: { store.testValues[name] ?? "" },
									set: { store.testValues[name] = $0; store.testOutput = nil }
								))
								.accessibilityLabel("Test value for \(name)")
								.accessibilityIdentifier("script-tool-test-input-\(input.id)")
							}
						}
					} else {
						Text("No inputs").font(.caption).foregroundStyle(.secondary)
					}
				}
				Spacer(minLength: 0)
				Button("Run Test") { Task { await store.test() } }
					.disabled(store.isTesting || store.draft?.isTestable != true)
					.accessibilityIdentifier("script-tool-run-test")
				if store.isTesting { ProgressView().controlSize(.small) }
			}
			if let output = store.testOutput {
				Text(output)
					.font(.system(.body, design: .monospaced))
					.textSelection(.enabled)
					.padding(10)
					.frame(maxWidth: .infinity, alignment: .leading)
					.background(
						Color(nsColor: .tobyLogBackground),
						in: RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					)
			}
		}
	}

	@ViewBuilder
	private var metadata: some View {
		if let draft = store.draft, let id = draft.id,
			let tool = store.tools.first(where: { $0.id == id }) {
			HStack(spacing: 6) {
				Text("Revision \(tool.currentRevision) · Used by \(flowCountDescription(tool.usedBy.count))")
					.font(.caption)
					.foregroundStyle(.secondary)
				if !tool.usedBy.isEmpty {
					Image(systemName: "info.circle")
						.foregroundStyle(.secondary)
						.help("Saving changes updates this tool in all \(flowCountDescription(tool.usedBy.count)).")
						.accessibilityLabel("Changes update all referencing flows")
				}
			}
		}
	}
}
