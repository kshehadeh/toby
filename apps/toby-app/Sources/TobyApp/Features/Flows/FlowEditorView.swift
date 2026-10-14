import SwiftUI
import UniformTypeIdentifiers

/// Flow editor laid out like the flow's overview: who it is, then its Steps,
/// actions and AI prompts in any order, and where it Shares. A flow needs at
/// least one step to save.
struct FlowEditorView: View {
	@Bindable var store: FlowsStore
	@Binding var draft: FlowEditorDraft
	@State private var isPickingTool = false
	@State private var scriptTools: [UserScriptTool] = []

	private var aiNodes: [FlowEditorNode] { draft.nodes.filter(\.isLLM) }

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				VStack(alignment: .leading, spacing: 30) {
					FlowEditorIdentityCard(draft: $draft)
					FlowTriggersEditor(triggers: $draft.triggers, invalidFields: $draft.invalidTriggerFields)
						.tutorialTip(.editorTrigger, available: draft.isNew)
						.id(TutorialStep.editorTrigger)
					if draft.nodes.contains(where: { $0.type == "agent_task" }) || !draft.projectId.isEmpty {
						HStack(spacing: 10) {
							FlowEditorFieldLabel("Project")
								.frame(width: 96, alignment: .leading)
							TextField("Project ID for the Agent Task (optional)", text: $draft.projectId)
								.textFieldStyle(.roundedBorder)
								.accessibilityIdentifier("flow-editor-project-id")
						}
					}
					howItWorks
				}
				.padding(.horizontal, 28)
				.padding(.vertical, 24)
				.frame(maxWidth: SettingsDesign.contentMaxWidth + 80, alignment: .leading)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.task(id: TutorialStore.shared.currentStep) {
				if draft.isNew, let step = TutorialStore.shared.currentStep,
					[.editorTrigger, .editorSources, .editorAI, .editorOutput].contains(step) {
					proxy.scrollTo(step, anchor: .center)
				}
			}
		}
		.onChange(of: draft.triggers) { old, new in
			if new.contains(where: { trigger in trigger.isHomeRefresh && !old.contains(where: { $0.id == trigger.id && $0.isHomeRefresh }) }) {
                draft.triggers.removeAll { $0.source.type == "home.action" }
            } else if new.contains(where: { trigger in trigger.source.type == "home.action" && !old.contains(where: { $0.id == trigger.id && $0.source.type == "home.action" }) }) {
                draft.triggers.removeAll { $0.isHomeRefresh }
            } else if old.contains(where: { $0.isHomeRefresh }) && !new.contains(where: { $0.isHomeRefresh }) && !draft.hasHomeActionTrigger {
                draft.destinations.removeAll { $0.type == "dashboard" }
            }
            draft.synchronizeHomeActionDestination(removingHomeAction: old.contains { $0.source.type == "home.action" } && !new.contains { $0.source.type == "home.action" })
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("flow-editor")
		.sheet(isPresented: $isPickingTool) {
			FlowToolPickerView(store: store, onPick: { tool in
				addTool(tool)
				isPickingTool = false
			}, onPickUserTool: { tool in
				addUserTool(tool)
				isPickingTool = false
			})
		}
		.task {
			scriptTools = (try? await TobyClient().listUserScriptTools()) ?? []
		}
	}

	// MARK: - How it works

	private var howItWorks: some View {
		VStack(alignment: .leading, spacing: 14) {
			VStack(alignment: .leading, spacing: 3) {
				Text("How it works")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(draft.nodes.isEmpty
					? "Add actions, AI prompts, or both. A flow needs at least one step to run."
					: "Each time the flow runs, Toby goes through these from top to bottom.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
					.fixedSize(horizontal: false, vertical: true)
			}

			FlowEditorPhaseHeader(number: 1, title: "Steps", detail: "What Toby does, in order. Later steps can use earlier answers.")
				.padding(.top, 4)
				.tutorialTip(.editorSources, available: draft.isNew)
				.id(TutorialStep.editorSources)
			if draft.nodes.isEmpty {
				Text("No steps yet. Add an action to gather information or do something, or an AI prompt to write or decide.")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
					.fixedSize(horizontal: false, vertical: true)
			}
			ForEach(draft.nodes) { node in
				stepCard(for: node)
					.dropDestination(for: String.self) { ids, _ in
						guard let id = ids.first, id != node.id else { return false }
						moveNode(id: id, before: node.id)
						return true
					}
			}
			VStack(alignment: .leading, spacing: 10) {
				FlowEditorAddButton(
					title: "Add an action",
					detail: "Tasks, calendar, mail, your script tools and more",
					accessibilityIdentifier: "flow-editor-add-step"
				) {
					isPickingTool = true
				}
				FlowEditorAddButton(
					title: "Add an AI prompt",
					detail: "Have AI summarize, write or decide from earlier steps",
					systemImage: "sparkles",
					accessibilityIdentifier: "flow-editor-add-ai"
				) {
					addLLM()
				}
				.tutorialTip(.editorAI, available: draft.isNew)
				.id(TutorialStep.editorAI)
			}

			FlowEditorPhaseHeader(number: 2, title: "Shares", detail: "Where the answer goes")
				.padding(.top, 10)
			if draft.destinations.isEmpty {
				Text("Nowhere picked yet. When you run the flow yourself, Toby shows the result in a window.")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
					.fixedSize(horizontal: false, vertical: true)
			}
			ForEach(draft.destinations) { destination in
				FlowEditorDestinationCard(
					destination: $draft.destination(destination),
					isHomeActionRequired: destination.type == "dashboard" && (draft.hasHomeActionTrigger || draft.hasHomeRefreshTrigger),
                    homeTriggerName: draft.hasHomeActionTrigger ? "Home Screen Action" : "Home refresh",
                    onSelectHomeRefresh: { draft.selectHomeRefresh() },
					onSelectHomeAction: { draft.selectHomeAction() }
				) {
					draft.destinations.removeAll { $0.id == destination.id }
				}
			}
			addDestinationMenu
				.tutorialTip(.editorOutput, available: draft.isNew)
				.id(TutorialStep.editorOutput)
		}
	}

	private var addDestinationMenu: some View {
		Menu {
			Button("Show it in a window") {
				draft.destinations.append(.modal())
			}
			Button("Show it on Home") {
				draft.selectHomeRefresh()
			}
			.disabled(draft.destinations.contains(where: { $0.type == "dashboard" }))
			Button("Email the result") {
				draft.destinations.append(.email())
			}
			.disabled(!store.isModuleConnected("email"))
			Button("Post it to Slack") {
				draft.destinations.append(.slack())
			}
			.disabled(!store.isModuleConnected("slack"))
		} label: {
			FlowEditorAddLabel(
				title: "Add a place",
				detail: store.isModuleConnected("email") && store.isModuleConnected("slack")
					? "Home, a window, email or Slack"
					: "Home or a window. Connect Mail or Slack to send it there.",
				systemImage: "plus"
			)
		}
		.menuStyle(.button)
		.buttonStyle(.plain)
		.menuIndicator(.hidden)
		.accessibilityIdentifier("flow-editor-add-destination")
	}

	// MARK: - Steps

	@ViewBuilder
	private func stepCard(for node: FlowEditorNode) -> some View {
		let position = draft.nodes.firstIndex(where: { $0.id == node.id }) ?? 0
		let canMoveUp = position > 0
		let canMoveDown = position < draft.nodes.count - 1
		if node.isLLM {
			FlowEditorAIStepCard(
				store: store,
				node: $draft.node(node),
				personaName: $draft.personaName,
				title: aiTitle(for: node),
				dataOptions: dataOptions(for: node),
				canMoveUp: canMoveUp,
				canMoveDown: canMoveDown,
				onMove: { direction in move(nodeId: node.id, direction: direction) },
				onFormatChange: { draft.adaptResultForNamedFields(nodeId: node.id) },
				onRemove: { draft.nodes.removeAll { $0.id == node.id } }
			)
		} else {
			FlowEditorToolCard(
				node: $draft.node(node),
				info: stepInfo(for: node),
				catalogTool: store.catalogTool(moduleName: node.moduleName, toolName: node.toolName, standardTool: node.standardTool),
				scriptTool: scriptTools.first(where: { $0.id == node.userToolId }),
				previousOutputs: draft.promptOutputs(before: node.id),
				outputOptions: outputOptions(before: node),
				triggerValues: triggerValues,
				canMoveUp: canMoveUp,
				canMoveDown: canMoveDown,
				onMove: { direction in move(nodeId: node.id, direction: direction) },
				onRemove: { draft.nodes.removeAll { $0.id == node.id } }
			)
		}
	}

	/// "Ask AI" for a single prompt; numbered once a flow has several.
	private func aiTitle(for node: FlowEditorNode) -> String {
		let ai = aiNodes
		guard ai.count > 1, let index = ai.firstIndex(where: { $0.id == node.id }) else { return "Ask AI" }
		return "Ask AI (\(index + 1))"
	}

	/// "AI answer" for a single prompt; numbered once a flow has several.
	private func aiAnswerTitle(for node: FlowEditorNode) -> String {
		let ai = aiNodes
		guard ai.count > 1, let index = ai.firstIndex(where: { $0.id == node.id }) else { return "AI answer" }
		return "AI answer \(index + 1)"
	}

	/// How an earlier step's output is named in data chips and pickers.
	private func dataOption(key: String, source: FlowEditorNode) -> FlowEditorDataOption {
		let many = source.outputKeys.count > 1
		if source.isLLM {
			let title = aiAnswerTitle(for: source)
			return FlowEditorDataOption(key: key, label: many ? "\(title) (\(key))" : title, detail: "AI")
		}
		let info = stepInfo(for: source)
		return FlowEditorDataOption(key: key, label: many ? "\(info.title) (\(key))" : info.title, detail: info.sourceName)
	}

	// MARK: - Step info

	private func stepInfo(for node: FlowEditorNode) -> FlowEditorStepInfo {
		let scriptTool = scriptTools.first(where: { $0.id == node.userToolId })
		let catalogTool = store.catalogTool(moduleName: node.moduleName, toolName: node.toolName, standardTool: node.standardTool)
		let module = catalogTool.flatMap { store.catalogModule(named: $0.moduleName) }
			?? (node.moduleName.isEmpty ? nil : store.catalogModule(named: node.moduleName))
		let category = node.standardTool.flatMap(FlowStory.category(forStandardTool:))

		let title: String
		if let scriptTool {
			title = scriptTool.name
		} else if let catalogTool {
			title = catalogTool.label
		} else if let standardTool = node.standardTool {
			title = FlowStory.title(forStandardTool: standardTool)
		} else if !node.toolName.isEmpty {
			title = ToolDisplayLabels.displayLabel(node.toolName)
		} else {
			title = "Tool"
		}

		let sourceName: String?
		if node.userToolId != nil {
			sourceName = "Script tool"
		} else if let module {
			sourceName = module.displayName
		} else if !node.moduleName.isEmpty {
			sourceName = node.moduleName.capitalized
		} else {
			sourceName = nil
		}

		let source: String?
		if node.userToolId != nil {
			source = "Your script tool"
		} else if let sourceName {
			source = "From \(sourceName)"
		} else if let category {
			source = FlowStory.source(forCategory: category)
		} else {
			source = nil
		}

		let systemImage: String
		if node.userToolId != nil {
			systemImage = "curlybraces"
		} else if let category, let symbol = FlowStory.systemImage(forCategory: category) {
			systemImage = symbol
		} else {
			systemImage = ToolDisplayLabels.iconForTool(node.toolName.isEmpty ? (node.standardTool ?? "") : node.toolName)
		}

		return FlowEditorStepInfo(
			title: title,
			source: source,
			sourceName: sourceName,
			description: FlowEditorText.firstSentence(scriptTool?.description ?? catalogTool?.description),
			iconURL: module?.resolvedIconURL,
			systemImage: systemImage
		)
	}

	private var triggerValues: [FlowTriggerValue] {
		FlowTriggerValues.values(for: draft.triggers)
	}

	/// Earlier outputs a step input can use, named by the step that makes them.
	private func outputOptions(before node: FlowEditorNode) -> [FlowStepOutputOption] {
		draft.promptOutputs(before: node.id).map { output in
			guard let source = draft.nodes.first(where: { $0.id == output.stepId }) else {
				return FlowStepOutputOption(
					key: output.key,
					title: output.key,
					textPath: output.textPath,
					systemImage: "arrow.turn.down.right"
				)
			}
			let many = source.outputKeys.count > 1
			if source.isLLM {
				let title = aiAnswerTitle(for: source)
				return FlowStepOutputOption(
					key: output.key,
					title: many ? "\(title) (\(output.key))" : title,
					textPath: output.textPath,
					systemImage: "sparkles"
				)
			}
			let info = stepInfo(for: source)
			return FlowStepOutputOption(
				key: output.key,
				title: many ? "\(info.title) (\(output.key))" : info.title,
				textPath: output.textPath,
				systemImage: info.systemImage
			)
		}
	}

	/// Step outputs the AI step can read, plus any data its prompt still
	/// references from a step that has since been removed.
	private func dataOptions(for llm: FlowEditorNode) -> [FlowEditorDataOption] {
		var options: [FlowEditorDataOption] = draft.promptOutputs(before: llm.id).map { output in
			guard let source = draft.nodes.first(where: { $0.id == output.stepId }) else {
				return FlowEditorDataOption(key: output.key, label: output.key, detail: nil)
			}
			return dataOption(key: output.key, source: source)
		}
		for key in FlowPromptComposer.referencedKeys(in: llm.userPrompt) where !options.contains(where: { $0.key == key }) {
			options.append(FlowEditorDataOption(key: key, label: key, detail: "No longer available"))
		}
		return options
	}

	// MARK: - Mutations

	private func addTool(_ tool: FlowCatalogTool) {
		draft.appendStep(.tool(moduleName: tool.moduleName, toolName: tool.toolName, required: tool.requiredFields))
	}

	private func addUserTool(_ tool: UserScriptTool) {
		draft.appendStep(.userTool(tool))
	}

	private func addLLM() {
		var node = FlowEditorNode.llm()
		node.userPrompt = FlowEditorDraft.defaultAIPrompt(reading: dataOptionsForNewAIStep())
		draft.appendStep(node)
	}

	/// Every output a step added at the end could read, latest writer wins.
	private func dataOptionsForNewAIStep() -> [FlowEditorDataOption] {
		draft.promptOutputs(before: "").compactMap { output in
			draft.nodes.first(where: { $0.id == output.stepId }).map { dataOption(key: output.key, source: $0) }
		}
	}

	private func move(nodeId: String, direction: Int) {
		guard let from = draft.nodes.firstIndex(where: { $0.id == nodeId }) else { return }
		let to = from + direction
		guard draft.nodes.indices.contains(to) else { return }
		draft.nodes.swapAt(from, to)
	}

	private func moveNode(id: String, before targetId: String) {
		guard let from = draft.nodes.firstIndex(where: { $0.id == id }) else { return }
		let node = draft.nodes.remove(at: from)
		let to = draft.nodes.firstIndex(where: { $0.id == targetId }) ?? draft.nodes.count
		draft.nodes.insert(node, at: to)
	}
}

// MARK: - Supporting types

struct FlowEditorStepInfo: Equatable {
	let title: String
	/// "From Todoist", "Your script tool", "From your calendar".
	let source: String?
	/// Bare integration name for chips, e.g. "Todoist".
	let sourceName: String?
	let description: String?
	let iconURL: URL?
	let systemImage: String
}

struct FlowEditorDataOption: Identifiable, Equatable {
	let key: String
	let label: String
	let detail: String?
	var id: String { key }
}

enum FlowEditorText {
	/// First sentence of a tool description; tool authors often follow it
	/// with return-shape notes meant for developers.
	static func firstSentence(_ text: String?) -> String? {
		guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
		if let range = text.range(of: ". ") {
			return String(text[..<range.lowerBound]) + "."
		}
		return text
	}

	/// "limit" → "Limit", "maxResults" → "Max results", "jql" → "JQL".
	static func inputLabel(_ key: String) -> String {
		if key.count <= 3, key.allSatisfy(\.isLetter) {
			return key.uppercased()
		}
		return ToolDisplayLabels.displayLabel(key)
	}
}

extension FlowEditorDraft {
	/// Starter prompt for a new AI step: plain instructions plus every
	/// earlier step's data as labeled blocks.
	static func defaultAIPrompt(reading options: [FlowEditorDataOption]) -> String {
		var composer = FlowPromptComposer(
			instructions: options.isEmpty
				? "Write a short update for me."
				: "Write a short update for me from the information below.",
			items: [],
			dataFirst: false
		)
		for option in options {
			composer = composer.including(key: option.key, label: option.label)
		}
		return composer.compose()
	}
}

// MARK: - Identity

private struct FlowEditorIdentityCard: View {
	@Binding var draft: FlowEditorDraft

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			HStack(alignment: .top, spacing: 16) {
				Image(systemName: FlowIconOption.resolvedSymbol(draft.icon))
					.font(.system(size: 22, weight: .semibold))
					.foregroundStyle(.white)
					.frame(width: 52, height: 52)
					.background(
						FlowColorOption.resolved(draft.color).color,
						in: RoundedRectangle(cornerRadius: 13, style: .continuous)
					)
					.accessibilityHidden(true)

				VStack(alignment: .leading, spacing: 12) {
					VStack(alignment: .leading, spacing: 6) {
						FlowEditorFieldLabel("Name")
						TextField("Flow name", text: $draft.name)
							.textFieldStyle(.roundedBorder)
							.font(.system(size: 14, weight: .medium))
							.accessibilityIdentifier("flow-editor-name")
					}
					VStack(alignment: .leading, spacing: 6) {
						FlowEditorFieldLabel("What it does")
						TextField("Describe what this flow does", text: $draft.description, axis: .vertical)
							.textFieldStyle(.roundedBorder)
							.lineLimit(2...4)
							.accessibilityIdentifier("flow-editor-description")
						Text("One or two sentences. People see this on the flow’s page.")
							.font(.system(size: 11))
							.foregroundStyle(SettingsDesign.rowDescription)
					}
				}
			}

			Rectangle()
				.fill(SettingsDesign.cardBorder)
				.frame(height: 1)

			HStack(spacing: 14) {
				FlowEditorFieldLabel("Look")
					.frame(width: 88, alignment: .leading)
				Picker("Icon", selection: $draft.icon) {
					ForEach(FlowIconOption.all) { option in
						Label(option.label, systemImage: option.symbol)
							.tag(option.symbol)
					}
				}
				.labelsHidden()
				.pickerStyle(.menu)
				.fixedSize()
				.accessibilityIdentifier("flow-editor-icon")

				HStack(spacing: 2) {
					ForEach(FlowColorOption.all) { option in
						FlowColorSwatchButton(
							option: option,
							isSelected: draft.color == option.id
						) {
							draft.color = option.id
						}
					}
				}
				.accessibilityElement(children: .contain)
				.accessibilityLabel("Color")
				.accessibilityIdentifier("flow-editor-color")
			}
		}
		.padding(.horizontal, 20)
		.padding(.vertical, 18)
		.flowEditorCard()
	}
}

// MARK: - Sources

private struct FlowEditorToolCard: View {
	@Binding var node: FlowEditorNode
	let info: FlowEditorStepInfo
	let catalogTool: FlowCatalogTool?
	let scriptTool: UserScriptTool?
	let previousOutputs: [FlowPromptOutput]
	let outputOptions: [FlowStepOutputOption]
	let triggerValues: [FlowTriggerValue]
	let canMoveUp: Bool
	let canMoveDown: Bool
	let onMove: (Int) -> Void
	let onRemove: () -> Void

	@State private var isExpanded = true

	private var specs: [FlowStepInputSpec] {
		FlowStepInputLayout.specs(catalogTool: catalogTool, scriptTool: scriptTool)
	}

	/// The source while open; what the step is set to once collapsed.
	private var subtitle: String? {
		if isExpanded { return info.source }
		return FlowStepInputLayout.summary(specs: specs, node: node, triggerValues: triggerValues, outputs: outputOptions)
			?? info.source
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			header
				.padding(.horizontal, 16)
				.padding(.vertical, 12)

			if isExpanded {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
					.padding(.leading, 72)
				VStack(alignment: .leading, spacing: 8) {
					if let description = info.description {
						Text(description)
							.font(.system(size: 12))
							.foregroundStyle(SettingsDesign.rowDescription)
							.fixedSize(horizontal: false, vertical: true)
							.padding(.bottom, 2)
					}
					if catalogTool?.looksLikeRuntimeIdRequired == true {
						Text("This tool needs an ID that usually comes from another step, and flows can’t pass those along yet.")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
							.fixedSize(horizontal: false, vertical: true)
					}
					if !specs.isEmpty {
						FlowEditorStepInputs(node: $node, specs: specs, triggerValues: triggerValues, outputs: outputOptions)
					} else if node.userToolId == nil, node.standardTool == nil {
						Text("\(node.moduleName).\(node.toolName)")
							.font(.system(size: 12, design: .monospaced))
							.foregroundStyle(SettingsDesign.rowDescription)
							.textSelection(.enabled)
					}
					if node.when != nil {
						FlowEditorConditionControls(node: $node, previousOutputs: previousOutputs)
							.padding(.top, 4)
					}
				}
				.padding(.leading, 72)
				.padding(.trailing, 16)
				.padding(.top, 12)
				.padding(.bottom, 14)
			}
		}
		.flowEditorCard()
		.accessibilityIdentifier("flow-editor-step-\(node.id)")
	}

	private var header: some View {
		HStack(spacing: 12) {
			Image(systemName: "line.3.horizontal")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 14)
				.contentShape(Rectangle())
				.draggable(node.id)
				.help("Drag to reorder")
				.accessibilityHidden(true)

			FlowStepIconTile(iconURL: info.iconURL, systemImage: info.systemImage)

			Button(action: toggleExpanded) {
				VStack(alignment: .leading, spacing: 1) {
					Text(info.title)
						.font(.system(size: 13, weight: .medium))
						.foregroundStyle(SettingsDesign.rowTitle)
					if let subtitle {
						Text(subtitle)
							.font(.system(size: 12))
							.foregroundStyle(SettingsDesign.rowDescription)
							.lineLimit(1)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityHint(isExpanded ? "Collapses this step" : "Shows this step’s settings")

			if node.when != nil, !isExpanded {
				Image(systemName: "arrow.triangle.branch")
					.font(.system(size: 11, weight: .medium))
					.foregroundStyle(AppTheme.tertiaryText)
					.help("Runs only when a condition is true")
					.accessibilityLabel("Has a condition")
			}

			Button(action: toggleExpanded) {
				Image(systemName: "chevron.down")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.secondaryText)
					.rotationEffect(.degrees(isExpanded ? 180 : 0))
					.frame(width: 26, height: 26)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel(isExpanded ? "Collapse \(info.title)" : "Expand \(info.title)")
			.accessibilityIdentifier("flow-editor-step-toggle-\(node.id)")

			FlowEditorStepMenu(accessibilityLabel: "Options for \(info.title)") {
				Button("Move up") { onMove(-1) }
					.disabled(!canMoveUp)
				Button("Move down") { onMove(1) }
					.disabled(!canMoveDown)
				Divider()
				if node.when == nil {
					Button("Only run when…") {
						node.when = FlowEditorConditionControls.defaultCondition(previousOutputs)
						isExpanded = true
					}
					.disabled(previousOutputs.isEmpty)
				} else {
					Button("Remove condition") { node.when = nil }
				}
				Divider()
				Button("Remove step", role: .destructive, action: onRemove)
			}
		}
	}

	private func toggleExpanded() {
		withAnimation(.easeOut(duration: 0.2)) { isExpanded.toggle() }
	}
}

// MARK: - AI step

private struct FlowEditorAIStepCard: View {
	@Bindable var store: FlowsStore
	@Binding var node: FlowEditorNode
	@Binding var personaName: String
	let title: String
	let dataOptions: [FlowEditorDataOption]
	let canMoveUp: Bool
	let canMoveDown: Bool
	let onMove: (Int) -> Void
	let onFormatChange: () -> Void
	let onRemove: () -> Void

	@State private var instructions = ""
	@State private var isRawPrompt = false
	@State private var hasLoadedPrompt = false
	@State private var showsToneAndRules = false

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(spacing: 12) {
				Image(systemName: "line.3.horizontal")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.frame(width: 14)
					.contentShape(Rectangle())
					.draggable(node.id)
					.help("Drag to reorder")
					.accessibilityHidden(true)
				FlowStepIconTile(iconURL: nil, systemImage: "sparkles", isAccent: true)
				VStack(alignment: .leading, spacing: 1) {
					Text(title)
						.font(.system(size: 13, weight: .medium))
						.foregroundStyle(SettingsDesign.rowTitle)
					Text(node.type == "agent_task" ? "Uses tools, skills, memory, and project context to complete the task." : "Reads what the steps above found and writes the answer.")
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowDescription)
						.fixedSize(horizontal: false, vertical: true)
				}
				Spacer(minLength: 0)
				FlowEditorStepMenu(accessibilityLabel: "Options for \(title)") {
					Button("Move up") { onMove(-1) }
						.disabled(!canMoveUp)
					Button("Move down") { onMove(1) }
						.disabled(!canMoveDown)
					Divider()
					Button("Remove AI prompt", role: .destructive, action: onRemove)
				}
			}

			VStack(alignment: .leading, spacing: 14) {
				VStack(alignment: .leading, spacing: 6) {
					FlowEditorFieldLabel("What should AI do?")
					TextField(
						"For example: Recommend the one thing I should work on next.",
						text: $instructions,
						axis: .vertical
					)
					.textFieldStyle(.roundedBorder)
					.lineLimit(3...12)
					.font(isRawPrompt ? .system(size: 12, design: .monospaced) : .system(size: 13))
					.accessibilityIdentifier("flow-editor-ai-instructions")
					if isRawPrompt {
						Text("This prompt puts data inside its sentences, so it’s shown exactly as written.")
							.font(.system(size: 11))
							.foregroundStyle(SettingsDesign.rowDescription)
					}
				}

				Picker("AI step", selection: $node.type) {
                    Text("Generate an answer").tag("llm_prompter")
                    Text("Agent Task — can use tools").tag("agent_task")
                }
                if node.type == "llm_prompter" { FlowEditorOutputControls(node: $node, onFormatChange: onFormatChange) }

				VStack(alignment: .leading, spacing: 8) {
					HStack(alignment: .firstTextBaseline, spacing: 8) {
						FlowEditorFieldLabel("Let it read")
						Text("Pick what AI sees each time")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
					}
					if dataOptions.isEmpty {
						Text("Nothing to read yet. Add an action above to give AI some information.")
							.font(.system(size: 12))
							.foregroundStyle(SettingsDesign.rowDescription)
					} else {
						FlowEditorWrapLayout(spacing: 8) {
							ForEach(dataOptions) { option in
								FlowEditorDataChip(option: option, isOn: isIncluded(option.key)) {
									toggle(option)
								}
							}
						}
					}
				}

				HStack(spacing: 10) {
					FlowEditorFieldLabel("Respond as")
						.frame(width: 96, alignment: .leading)
					Picker("Respond as", selection: $personaName) {
						Text("Default persona").tag("")
						ForEach(store.personaOptions, id: \.name) { option in
							Text(option.label).tag(option.name)
						}
						if !personaName.isEmpty,
							!store.personaOptions.contains(where: { $0.name == personaName })
						{
							Text(personaName).tag(personaName)
						}
					}
					.labelsHidden()
					.pickerStyle(.menu)
					.fixedSize()
					.accessibilityIdentifier("flow-editor-persona")
				}

				DisclosureGroup(isExpanded: $showsToneAndRules) {
					TextField("For example: Be brief and specific.", text: $node.systemPrompt, axis: .vertical)
						.textFieldStyle(.roundedBorder)
						.lineLimit(2...8)
						.padding(.top, 6)
						.accessibilityIdentifier("flow-editor-ai-rules")
				} label: {
					HStack(spacing: 6) {
						FlowEditorFieldLabel("Tone and rules")
						Text("Optional")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
					}
				}
			}
			.padding(.leading, 68)
		}
		.padding(.horizontal, 16)
		.padding(.top, 14)
		.padding(.bottom, 16)
		.flowEditorCard()
		.accessibilityIdentifier("flow-editor-ai-step-\(node.id)")
		.onAppear(perform: loadPrompt)
		.onChange(of: instructions) { _, newValue in
			applyInstructions(newValue)
		}
	}

	private func loadPrompt() {
		defer { hasLoadedPrompt = true }
		if let parsed = FlowPromptComposer.parse(node.userPrompt) {
			isRawPrompt = false
			instructions = parsed.instructions
		} else {
			isRawPrompt = true
			instructions = node.userPrompt
		}
	}

	/// Writes back only real edits, so opening the editor never rewrites a
	/// stored prompt.
	private func applyInstructions(_ newValue: String) {
		guard hasLoadedPrompt else { return }
		if isRawPrompt {
			if node.userPrompt != newValue { node.userPrompt = newValue }
			return
		}
		guard var parsed = FlowPromptComposer.parse(node.userPrompt) else {
			if node.userPrompt != newValue { node.userPrompt = newValue }
			return
		}
		guard parsed.instructions != newValue else { return }
		parsed.instructions = newValue
		node.userPrompt = parsed.compose()
	}

	private func isIncluded(_ key: String) -> Bool {
		if let parsed = FlowPromptComposer.parse(node.userPrompt) {
			return parsed.keys.contains(key)
		}
		return FlowPromptComposer.referencedKeys(in: node.userPrompt).contains(key)
	}

	private func toggle(_ option: FlowEditorDataOption) {
		let included = isIncluded(option.key)
		if !isRawPrompt, var parsed = FlowPromptComposer.parse(node.userPrompt) {
			if hasLoadedPrompt { parsed.instructions = instructions }
			parsed = included ? parsed.excluding(key: option.key) : parsed.including(key: option.key, label: option.label)
			node.userPrompt = parsed.compose()
		} else {
			node.userPrompt = included
				? FlowPromptComposer.removingReferences(to: option.key, from: node.userPrompt)
				: FlowPromptComposer.appendingReference(to: option.key, label: option.label, in: node.userPrompt)
			loadPrompt()
		}
	}
}

private struct FlowEditorDataChip: View {
	let option: FlowEditorDataOption
	let isOn: Bool
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 6) {
				ZStack {
					if isOn {
						Circle().fill(AppTheme.accent)
						Image(systemName: "checkmark")
							.font(.system(size: 7, weight: .heavy))
							.foregroundStyle(.white)
					} else {
						Circle().strokeBorder(SettingsDesign.controlBorder, lineWidth: 1)
					}
				}
				.frame(width: 15, height: 15)
				Text(option.label)
					.foregroundStyle(isOn ? SettingsDesign.rowTitle : SettingsDesign.rowDescription)
				if let detail = option.detail {
					Text(detail)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
			.font(.system(size: 12))
			.padding(.leading, 8)
			.padding(.trailing, 11)
			.frame(height: 28)
			.background(Capsule().fill(isOn ? AppTheme.accent.opacity(0.10) : Color.clear))
			.overlay(
				Capsule().strokeBorder(isOn ? AppTheme.accent.opacity(0.40) : SettingsDesign.controlBorder, lineWidth: 1)
			)
			.contentShape(Capsule())
		}
		.buttonStyle(.plain)
		.accessibilityLabel([option.label, option.detail].compactMap { $0 }.joined(separator: ", "))
		.accessibilityAddTraits(isOn ? .isSelected : [])
		.accessibilityIdentifier("flow-editor-data-\(option.key)")
	}
}

// MARK: - Destinations

struct FlowEditorDestinationCard: View {
	@Binding var destination: FlowEditorDestination
	var isHomeActionRequired = false
    var homeTriggerName = "Home Screen Action"
    var onSelectHomeRefresh: () -> Void = {}
	var onSelectHomeAction: () -> Void = {}
	let onRemove: () -> Void

	private var isRunner: Bool { destination.dashboardVariant == "runner" }

	private var title: String {
		switch destination.type {
		case "dashboard": return "Show it on Home"
		case "email": return "Email the result"
		case "slack": return "Post it to Slack"
		case "modal": return "Show it in a window"
		default: return destination.label
		}
	}

	private var subtitle: String {
		switch destination.type {
		case "dashboard": return isRunner ? "As a button in Home’s Actions" : "As a card on your Home screen"
		case "email": return "Sends a message after each run"
		case "slack": return "Posts a message after each run"
		case "modal": return "Opens the result when you run it yourself"
		default: return ""
		}
	}

	private var systemImage: String {
		switch destination.type {
		case "dashboard": return "house"
		case "email": return "envelope"
		case "slack": return "number"
		case "modal": return "macwindow"
		default: return "paperplane"
		}
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(spacing: 12) {
				FlowStepIconTile(iconURL: nil, systemImage: systemImage)
				VStack(alignment: .leading, spacing: 1) {
					Text(title)
						.font(.system(size: 13, weight: .medium))
						.foregroundStyle(SettingsDesign.rowTitle)
					if !subtitle.isEmpty {
						Text(subtitle)
							.font(.system(size: 12))
							.foregroundStyle(SettingsDesign.rowDescription)
					}
				}
				Spacer(minLength: 0)
				FlowEditorStepMenu(accessibilityLabel: "Options for \(title)") {
					Button("Remove", role: .destructive, action: onRemove)
						.disabled(isHomeActionRequired)
				}
			}

			if destination.type != "modal" {
				content
					.padding(.leading, 42)
			}
		}
		.padding(.horizontal, 16)
		.padding(.top, 14)
		.padding(.bottom, 16)
		.flowEditorCard()
	}

	@ViewBuilder
	private var content: some View {
		switch destination.type {
		case "dashboard":
			VStack(alignment: .leading, spacing: 14) {
				HStack(spacing: 10) {
					FlowEditorChoiceTile(
						systemImage: "rectangle.grid.1x2",
						title: "A card with the answer",
						detail: "Stays on Home and keeps itself current",
						isSelected: !isRunner
					) {
						destination.dashboardVariant = "informational"
                        onSelectHomeRefresh()
					}
					.disabled(isHomeActionRequired)
					.accessibilityIdentifier("flow-editor-home-card-choice")
					FlowEditorChoiceTile(
						systemImage: "play.square",
						title: "A button in Actions",
						detail: "Runs only when you click it",
						isSelected: isRunner
					) {
						destination.dashboardVariant = "runner"
						onSelectHomeAction()
					}
					.disabled(isHomeActionRequired)
					.accessibilityIdentifier("flow-editor-home-action-choice")
				}
				if isHomeActionRequired {
					Text("Required by the \(homeTriggerName) trigger. Change or remove that trigger to change this location.")
						.font(.caption).foregroundStyle(SettingsDesign.rowDescription)
						.accessibilityIdentifier("flow-editor-home-action-location-lock")
				}
				HStack(spacing: 10) {
					FlowEditorFieldLabel("Home color")
						.frame(width: 96, alignment: .leading)
					DashboardColorPicker(selection: $destination.dashboardColor, defaultLabel: "Automatic")
						.pickerStyle(.menu)
						.labelsHidden()
						.accessibilityIdentifier("flow-editor-dashboard-color")
				}
				Text("Default appearance on Home. Edit Home can override it on this Mac.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
					.padding(.leading, 106)
					.fixedSize(horizontal: false, vertical: true)
				if !isRunner {
					VStack(alignment: .leading, spacing: 6) {
						HStack(spacing: 10) {
							FlowEditorFieldLabel("Updates")
								.frame(width: 96, alignment: .leading)
							Picker("Updates", selection: $destination.dashboardRefresh) {
								Text("Automatically").tag("asNeeded")
								Text("Only when I refresh").tag("manual")
							}
							.labelsHidden()
							.pickerStyle(.segmented)
							.fixedSize()
						}
						Text(destination.dashboardRefresh == "manual"
							? "Only refreshes when you click refresh on the card or the Home toolbar."
							: "Refreshes when you open Home and it’s a few minutes old, like mail and calendar.")
							.font(.system(size: 12))
							.foregroundStyle(SettingsDesign.rowDescription)
							.padding(.leading, 106)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
			}
		case "email":
			VStack(alignment: .leading, spacing: 8) {
				FlowEditorLabeledField(label: "To", placeholder: "name@example.com, another@example.com", text: $destination.emailTo)
				FlowEditorLabeledField(label: "Subject", placeholder: "Subject line", text: $destination.emailSubject)
			}
		case "slack":
			FlowEditorLabeledField(label: "Channel", placeholder: "#general", text: $destination.slackChannel)
		default:
			EmptyView()
		}
	}
}

private struct FlowEditorChoiceTile: View {
	let systemImage: String
	let title: String
	let detail: String
	let isSelected: Bool
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			VStack(alignment: .leading, spacing: 4) {
				Image(systemName: systemImage)
					.font(.system(size: 15, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
					.padding(.bottom, 2)
				Text(title)
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(detail)
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
					.fixedSize(horizontal: false, vertical: true)
			}
			.padding(12)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(
				RoundedRectangle(cornerRadius: 9, style: .continuous)
					.fill(isSelected ? AppTheme.accent.opacity(0.07) : SettingsDesign.cardBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: 9, style: .continuous)
					.strokeBorder(isSelected ? AppTheme.accent : SettingsDesign.controlBorder, lineWidth: isSelected ? 1.5 : 1)
			)
			.contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
		}
		.buttonStyle(.plain)
		.accessibilityAddTraits(isSelected ? .isSelected : [])
	}
}

private struct FlowEditorLabeledField: View {
	let label: String
	let placeholder: String
	@Binding var text: String

	var body: some View {
		HStack(spacing: 10) {
			FlowEditorFieldLabel(label)
				.frame(width: 96, alignment: .leading)
			TextField(placeholder, text: $text)
				.textFieldStyle(.roundedBorder)
				.accessibilityLabel(label)
		}
	}
}

// MARK: - Small pieces

private struct FlowEditorFieldLabel: View {
	let text: String

	init(_ text: String) {
		self.text = text
	}

	var body: some View {
		Text(text)
			.font(.system(size: 12, weight: .semibold))
			.foregroundStyle(SettingsDesign.rowTitle)
	}
}

private struct FlowEditorPhaseHeader: View {
	let number: Int
	let title: String
	let detail: String

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: 8) {
			Text("\(number). \(title)".uppercased())
				.font(.system(size: 10, weight: .semibold))
				.tracking(0.7)
				.foregroundStyle(AppTheme.tertiaryText)
			Text(detail)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
		}
		.accessibilityElement(children: .combine)
		.accessibilityAddTraits(.isHeader)
	}
}

private struct FlowEditorAddLabel: View {
	let title: String
	let detail: String
	var systemImage: String = "plus"

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: systemImage)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
			Text(title)
				.font(.system(size: 13, weight: .medium))
				.foregroundStyle(AppTheme.accent)
			Text(detail)
				.font(.system(size: 12))
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(1)
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 16)
		.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
		.contentShape(Rectangle())
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius, style: .continuous)
				.strokeBorder(SettingsDesign.controlBorder, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
		)
	}
}

private struct FlowEditorAddButton: View {
	let title: String
	let detail: String
	var systemImage: String = "plus"
	let accessibilityIdentifier: String
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			FlowEditorAddLabel(title: title, detail: detail, systemImage: systemImage)
		}
		.buttonStyle(.plain)
		.accessibilityLabel(title)
		.accessibilityIdentifier(accessibilityIdentifier)
	}
}

private struct FlowEditorStepMenu<Items: View>: View {
	let accessibilityLabel: String
	@ViewBuilder var items: () -> Items

	var body: some View {
		Menu {
			items()
		} label: {
			Image(systemName: "ellipsis")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 26, height: 26)
				.contentShape(Rectangle())
		}
		.menuStyle(.borderlessButton)
		.menuIndicator(.hidden)
		.fixedSize()
		.accessibilityLabel(accessibilityLabel)
	}
}

/// Wraps chips onto as many lines as they need.
private struct FlowEditorWrapLayout: Layout {
	var spacing: CGFloat = 8

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let maxWidth = proposal.width ?? .infinity
		var x: CGFloat = 0
		var y: CGFloat = 0
		var rowHeight: CGFloat = 0
		var widest: CGFloat = 0
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			if x > 0, x + size.width > maxWidth {
				x = 0
				y += rowHeight + spacing
				rowHeight = 0
			}
			x += size.width
			widest = max(widest, x)
			x += spacing
			rowHeight = max(rowHeight, size.height)
		}
		return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		var x = bounds.minX
		var y = bounds.minY
		var rowHeight: CGFloat = 0
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			if x > bounds.minX, x + size.width > bounds.maxX {
				x = bounds.minX
				y += rowHeight + spacing
				rowHeight = 0
			}
			subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
			x += size.width + spacing
			rowHeight = max(rowHeight, size.height)
		}
	}
}

extension View {
	/// The editor's card chrome: settings card fill, hairline, concentric corners.
	func flowEditorCard() -> some View {
		let shape = AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
		return self
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(SettingsDesign.cardBackground, in: shape)
			.overlay {
				shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
	}
}

private struct FlowColorSwatchButton: View {
	let option: FlowColorOption
	let isSelected: Bool
	let action: () -> Void

	@State private var isHovered = false

	var body: some View {
		Button(action: action) {
			ZStack {
				Circle()
					.fill(option.color)
					.frame(width: 22, height: 22)
				if isSelected {
					Circle()
						.strokeBorder(AppTheme.primaryText, lineWidth: 2)
						.frame(width: 28, height: 28)
				} else if isHovered {
					Circle()
						.strokeBorder(AppTheme.secondaryText.opacity(0.5), lineWidth: 1.5)
						.frame(width: 28, height: 28)
				}
			}
			.frame(width: 32, height: 32)
			.contentShape(Circle())
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.help(option.label)
		.accessibilityLabel(option.label)
		.accessibilityAddTraits(isSelected ? .isSelected : [])
		.accessibilityIdentifier("flow-editor-color-\(option.id)")
	}
}
