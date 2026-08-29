import SwiftUI

struct FlowEditorView: View {
	@Bindable var store: FlowsStore
	@Binding var draft: FlowEditorDraft
	@State private var pickingToolForIndex: Int?

	var body: some View {
		VStack(spacing: 0) {
			header
				.padding(.horizontal, 24)
				.padding(.vertical, 16)
			Divider().overlay(SettingsDesign.cardBorder)
			ScrollView {
				VStack(alignment: .leading, spacing: 22) {
					metaFields
					nodesSection
					destinationsSection
					if let editorError = store.editorError, !editorError.isEmpty {
						InlineStatusMessage(message: editorError, tone: .error, font: .caption)
					}
				}
				.padding(24)
				.frame(maxWidth: SettingsDesign.contentMaxWidth + 80, alignment: .leading)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("flow-editor")
		.sheet(isPresented: Binding(
			get: { pickingToolForIndex != nil },
			set: { if !$0 { pickingToolForIndex = nil } }
		)) {
			FlowToolPickerView(store: store) { tool in
				addTool(tool)
				pickingToolForIndex = nil
			}
		}
	}

	private var header: some View {
		HStack(spacing: 12) {
			VStack(alignment: .leading, spacing: 4) {
				Text(draft.isNew ? "New flow" : "Edit flow")
					.font(.system(size: 20, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text("Steps run in order. Tool inputs are values you set now — they are not filled from earlier steps.")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			Spacer()
			Button("Cancel") { store.cancelEditor() }
				.disabled(store.isSaving)
			Button(store.isSaving ? "Saving…" : "Save") {
				Task { await store.saveEditor() }
			}
			.keyboardShortcut(.defaultAction)
			.disabled(store.isSaving || draft.nodes.isEmpty || draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
			.accessibilityIdentifier("flow-editor-save")
		}
	}

	private var metaFields: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("Details")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			TextField("Name", text: $draft.name)
				.textFieldStyle(.roundedBorder)
			TextField("Description (optional)", text: $draft.description)
				.textFieldStyle(.roundedBorder)
			iconPicker
			if draft.nodes.contains(where: \.isLLM) {
				personaPicker
			}
		}
	}

	private var iconPicker: some View {
		HStack(spacing: 10) {
			Image(systemName: FlowIconOption.resolvedSymbol(draft.icon))
				.font(.system(size: 16, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
				.frame(width: 24, height: 24)
				.accessibilityHidden(true)
			Picker("Icon", selection: $draft.icon) {
				ForEach(FlowIconOption.all) { option in
					Label(option.label, systemImage: option.symbol)
						.tag(option.symbol)
				}
			}
			.pickerStyle(.menu)
			.controlSize(.regular)
			.accessibilityIdentifier("flow-editor-icon")
		}
		.frame(maxWidth: 280, alignment: .leading)
	}

	private var personaPicker: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Persona")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("Persona", selection: $draft.personaName) {
				Text("Default").tag("")
				ForEach(store.personaOptions, id: \.name) { option in
					Text(option.label).tag(option.name)
				}
				if !draft.personaName.isEmpty,
					!store.personaOptions.contains(where: { $0.name == draft.personaName })
				{
					Text(draft.personaName).tag(draft.personaName)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.accessibilityIdentifier("flow-editor-persona")
		}
	}

	private var nodesSection: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack {
				Text("Steps")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Spacer()
				Menu {
					Button("Add tool…") { pickingToolForIndex = draft.nodes.count }
					Button("Add LLM step") { addLLM() }
						.disabled(draft.nodes.contains(where: \.isLLM))
				} label: {
					Label("Add step", systemImage: "plus")
				}
				.menuStyle(.borderlessButton)
				.fixedSize()
				.accessibilityIdentifier("flow-editor-add-step")
			}

			if draft.nodes.isEmpty {
				Text("Add a tool to start. Example: turn Wi-Fi off, then minimize all windows.")
					.font(.system(size: 13))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				VStack(alignment: .leading, spacing: 12) {
					ForEach($draft.nodes) { $node in
						FlowEditorNodeCard(
							node: $node,
							catalogTool: store.catalogTool(moduleName: node.moduleName, toolName: node.toolName),
							canMoveUp: draft.nodes.first?.id != node.id && !node.isLLM,
							canMoveDown: draft.nodes.last?.id != node.id && !node.isLLM,
							onMove: { direction in move(nodeId: node.id, direction: direction) },
							onDelete: { draft.nodes.removeAll { $0.id == node.id } }
						)
					}
				}
			}
		}
	}

	private var destinationsSection: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack {
				Text("When this flow finishes")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Spacer()
				Menu {
					Button("Show a result window") {
						draft.destinations.append(.modal())
					}
					Button("Send email") {
						draft.destinations.append(.email())
					}
					.disabled(!store.isModuleConnected("email"))
					Button("Post to Slack") {
						draft.destinations.append(.slack())
					}
					.disabled(!store.isModuleConnected("slack"))
					Button("Dashboard") {
						if !draft.destinations.contains(where: { $0.type == "dashboard" }) {
							draft.destinations.append(.dashboard())
						}
					}
					.disabled(draft.destinations.contains(where: { $0.type == "dashboard" }))
				} label: {
					Label("Add destination", systemImage: "plus")
				}
				.menuStyle(.borderlessButton)
				.fixedSize()
			}

			if !store.isModuleConnected("email") || !store.isModuleConnected("slack") {
				Text("Email and Slack destinations need those integrations connected.")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
			}

			ForEach($draft.destinations) { $destination in
				FlowDestinationRow(destination: $destination) {
					draft.destinations.removeAll { $0.id == destination.id }
				}
			}
		}
	}

	private func addTool(_ tool: FlowCatalogTool) {
		if let last = draft.nodes.last, last.isLLM {
			draft.nodes.insert(
				.tool(moduleName: tool.moduleName, toolName: tool.toolName, required: tool.requiredFields),
				at: draft.nodes.count - 1
			)
		} else {
			draft.nodes.append(
				.tool(moduleName: tool.moduleName, toolName: tool.toolName, required: tool.requiredFields)
			)
		}
	}

	private func addLLM() {
		guard !draft.nodes.contains(where: \.isLLM) else { return }
		draft.nodes.append(.llm())
	}

	private func move(nodeId: String, direction: Int) {
		guard let index = draft.nodes.firstIndex(where: { $0.id == nodeId }) else { return }
		let next = index + direction
		guard draft.nodes.indices.contains(next) else { return }
		if draft.nodes[next].isLLM && direction > 0 { return }
		draft.nodes.swapAt(index, next)
	}
}

private struct FlowEditorNodeCard: View {
	@Binding var node: FlowEditorNode
	let catalogTool: FlowCatalogTool?
	let canMoveUp: Bool
	let canMoveDown: Bool
	let onMove: (Int) -> Void
	let onDelete: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			HStack {
				Image(systemName: node.isLLM ? "text.bubble" : "wrench.and.screwdriver")
					.foregroundStyle(AppTheme.accent)
				Text(title)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Spacer()
				Button { onMove(-1) } label: { Image(systemName: "chevron.up") }
					.disabled(!canMoveUp)
					.buttonStyle(.borderless)
				Button { onMove(1) } label: { Image(systemName: "chevron.down") }
					.disabled(!canMoveDown)
					.buttonStyle(.borderless)
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.buttonStyle(.borderless)
			}

			if node.isLLM {
				Text("The model writes markdown from your prompt. It cannot call tools.")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
				TextField("System prompt", text: $node.systemPrompt, axis: .vertical)
					.textFieldStyle(.roundedBorder)
					.lineLimit(3...8)
				TextField("User prompt", text: $node.userPrompt, axis: .vertical)
					.textFieldStyle(.roundedBorder)
					.lineLimit(3...8)
			} else if let catalogTool {
				Text(catalogTool.description ?? "")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
				if catalogTool.looksLikeRuntimeIdRequired {
					Text("This tool needs values that usually come from another step. Step-to-step mapping is not available yet.")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				let properties = catalogTool.inputSchema.properties ?? [:]
				let required = Set(catalogTool.requiredFields)
				let keys = (catalogTool.requiredFields + properties.keys.sorted()).uniqued()
				ForEach(keys, id: \.self) { key in
					let prop = properties[key]
					HStack {
						Text(required.contains(key) ? "\(key)*" : key)
							.font(.system(size: 12, weight: .medium))
							.frame(width: 120, alignment: .leading)
						if prop?.type == "boolean" {
							Toggle("", isOn: boolBinding(for: key))
								.labelsHidden()
								.tint(SettingsDesign.toggleTint)
						} else {
							TextField(prop?.description ?? key, text: stringBinding(for: key))
								.textFieldStyle(.roundedBorder)
						}
					}
				}
			} else {
				Text("\(node.moduleName).\(node.toolName)")
					.font(.system(size: 12, design: .monospaced))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
		.padding(12)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
	}

	private var title: String {
		if node.isLLM { return "LLM Prompter" }
		return catalogTool?.label ?? node.toolName
	}

	private func stringBinding(for key: String) -> Binding<String> {
		Binding(
			get: { node.constInputs[key] ?? "" },
			set: { node.constInputs[key] = $0 }
		)
	}

	private func boolBinding(for key: String) -> Binding<Bool> {
		Binding(
			get: { (node.constInputs[key] ?? "false").lowercased() == "true" },
			set: { node.constInputs[key] = $0 ? "true" : "false" }
		)
	}
}

private struct FlowDestinationRow: View {
	@Binding var destination: FlowEditorDestination
	let onDelete: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				Text(destination.label)
					.font(.system(size: 13, weight: .semibold))
				Spacer()
				Button(role: .destructive, action: onDelete) {
					Image(systemName: "trash")
				}
				.buttonStyle(.borderless)
			}
			if destination.type == "email" {
				TextField("To (comma-separated)", text: $destination.emailTo)
					.textFieldStyle(.roundedBorder)
				TextField("Subject", text: $destination.emailSubject)
					.textFieldStyle(.roundedBorder)
			} else if destination.type == "slack" {
				TextField("Channel (e.g. #general)", text: $destination.slackChannel)
					.textFieldStyle(.roundedBorder)
			} else if destination.type == "dashboard" {
				Picker("Card type", selection: $destination.dashboardVariant) {
					Text("Informational").tag("informational")
					Text("Runner only").tag("runner")
				}
				.pickerStyle(.menu)
				.controlSize(.regular)
				if destination.dashboardVariant != "runner" {
					Picker("Refresh", selection: $destination.dashboardRefresh) {
						Text("As Needed").tag("asNeeded")
						Text("Manual").tag("manual")
					}
					.pickerStyle(.menu)
					.controlSize(.regular)
				}
				Text(dashboardDestinationHelp)
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				Text("After a successful run, Toby shows the result in a window.")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
		.padding(12)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
	}

	private var dashboardDestinationHelp: String {
		if destination.dashboardVariant == "runner" {
			return "An Actions button on the home dashboard. Hover for the description; the flow only runs when you click it."
		}
		if destination.dashboardRefresh == "manual" {
			return "Only updates when you tap refresh on this card or the dashboard toolbar."
		}
		return "Updates when you open Home (if older than a few minutes) or when you tap refresh, like mail, tasks, and calendar."
	}
}

struct FlowToolPickerView: View {
	@Bindable var store: FlowsStore
	let onPick: (FlowCatalogTool) -> Void
	@Environment(\.dismiss) private var dismiss
	@State private var query = ""

	var body: some View {
		NavigationStack {
			List {
				if let catalog = store.catalog, !catalog.modules.isEmpty {
					ForEach(filteredModules(catalog)) { module in
						Section(sectionTitle(module)) {
							ForEach(filteredTools(module)) { tool in
								Button {
									onPick(tool)
									dismiss()
								} label: {
									VStack(alignment: .leading, spacing: 3) {
										Text(tool.label)
											.foregroundStyle(SettingsDesign.rowTitle)
										if let description = tool.description, !description.isEmpty {
											Text(description)
												.font(.caption)
												.foregroundStyle(SettingsDesign.rowDescription)
												.lineLimit(2)
										}
									}
								}
								.buttonStyle(.plain)
							}
						}
					}
				} else if let editorError = store.editorError, !editorError.isEmpty {
					Text(editorError)
						.foregroundStyle(SettingsDesign.rowDescription)
				} else {
					Text("No integrations with tools are available. Open Integrations to confirm plugins are installed, then try again.")
						.foregroundStyle(SettingsDesign.rowDescription)
				}
			}
			.searchable(text: $query)
			.navigationTitle("Choose a tool")
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Cancel") { dismiss() }
				}
			}
			.task {
				await store.loadCatalog()
			}
		}
		.frame(minWidth: 480, minHeight: 420)
	}

	private func sectionTitle(_ module: FlowCatalogModule) -> String {
		module.connected ? module.displayName : "\(module.displayName) (not connected)"
	}

	private func filteredModules(_ catalog: FlowToolCatalog) -> [FlowCatalogModule] {
		catalog.modules.filter { !$0.tools.isEmpty && !filteredTools($0).isEmpty }
	}

	private func filteredTools(_ module: FlowCatalogModule) -> [FlowCatalogTool] {
		let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		if q.isEmpty { return module.tools }
		return module.tools.filter {
			$0.label.lowercased().contains(q)
				|| $0.toolName.lowercased().contains(q)
				|| ($0.description ?? "").lowercased().contains(q)
		}
	}
}

private extension Array where Element == String {
	func uniqued() -> [String] {
		var seen = Set<String>()
		return filter { seen.insert($0).inserted }
	}
}
