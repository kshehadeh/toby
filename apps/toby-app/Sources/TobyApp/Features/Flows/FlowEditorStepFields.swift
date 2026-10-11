import SwiftUI

// MARK: - Values a step can link to

/// A value from the flow's trigger, named in plain words ("The new file")
/// instead of a context path.
struct FlowTriggerValue: Identifiable, Equatable {
	let path: String
	let label: String
	let systemImage: String
	var id: String { path }
}

enum FlowTriggerValues {
	static let filePath = "event.payload.changes.0.path"
	static let changesPath = "event.payload.changes"
	static let folderPath = "event.payload.folder"
	static let idlePath = "event.payload.idleSeconds"
	static let timePath = "event.occurredAt"

	/// Everything this flow's triggers can hand a step, first trigger first.
	static func values(for triggers: [FlowTriggerSpec]) -> [FlowTriggerValue] {
		var values: [FlowTriggerValue] = []
		func add(_ value: FlowTriggerValue) {
			if !values.contains(where: { $0.path == value.path }) { values.append(value) }
		}
		for trigger in triggers {
			switch trigger.source.type {
			case "macos.fileChanges":
				add(FlowTriggerValue(path: filePath, label: fileLabel(for: trigger), systemImage: "doc"))
				add(FlowTriggerValue(path: changesPath, label: "All changed files", systemImage: "doc.on.doc"))
				add(FlowTriggerValue(path: folderPath, label: "The watched folder", systemImage: "folder"))
			case "macos.userReturned":
				add(FlowTriggerValue(path: idlePath, label: "Time away in seconds", systemImage: "hourglass"))
			default:
				break
			}
		}
		if triggers.contains(where: { !$0.isUserInvoked && !$0.isHomeRefresh }) {
			add(FlowTriggerValue(path: timePath, label: "When it happened", systemImage: "clock"))
		}
		return values
	}

	/// "The new file" for a per-file trigger on new files; "The first changed
	/// file" when a run gets a batch.
	static func fileLabel(for trigger: FlowTriggerSpec) -> String {
		let kinds = Set(trigger.source.kinds ?? [])
		let noun = kinds == ["new"] ? "new file" : kinds == ["deleted"] ? "deleted file" : "changed file"
		return trigger.source.runPerFile == true ? "The \(noun)" : "The first \(noun)"
	}
}

/// An earlier step's output, named by the step that produces it.
struct FlowStepOutputOption: Identifiable, Equatable {
	let key: String
	let title: String
	/// Path that turns the output into text ("markdown" for an AI answer).
	let textPath: String?
	let systemImage: String
	var id: String { key }
}

// MARK: - Inputs

/// One tool input, with what its schema says about how to edit it.
struct FlowStepInputSpec: Identifiable, Equatable {
	enum Kind: Equatable {
		case text
		case number
		case toggle
		case choice([Choice])
	}

	struct Choice: Equatable {
		let value: String
		let label: String
	}

	let key: String
	let property: FlowInputProperty?
	let isRequired: Bool
	var id: String { key }

	var label: String {
		if let title = property?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
			return title
		}
		return FlowEditorText.inputLabel(key)
	}

	var kind: Kind {
		if property?.type == "boolean" { return .toggle }
		if let values = property?.enumValues, !values.isEmpty {
			let names = property?.enumNames
			let labels = names?.count == values.count ? names ?? [] : values.map(FlowEditorText.choiceLabel)
			return .choice(zip(values, labels).map { Choice(value: $0, label: $1) })
		}
		if property?.type == "integer" || property?.type == "number" { return .number }
		return .text
	}

	/// Shown inside an empty field: the default when the schema has one.
	var placeholder: String {
		if let value = property?.defaultValue, !value.isEmpty { return value }
		return isRequired ? "Required" : "Optional"
	}

	/// "1 to 100" for a small numeric range; huge ranges say nothing useful.
	var rangeHint: String? {
		guard let minimum = property?.minimum, let maximum = property?.maximum,
			maximum > minimum, maximum - minimum <= 10_000
		else { return nil }
		return "\(Self.format(minimum)) to \(Self.format(maximum))"
	}

	/// The tool author's description, for the label's tooltip.
	var help: String? { FlowEditorText.firstSentence(property?.description) }

	func choiceLabel(for value: String) -> String {
		if case let .choice(choices) = kind, let choice = choices.first(where: { $0.value == value }) {
			return choice.label
		}
		return value
	}

	private static func format(_ number: Double) -> String {
		number.rounded() == number ? String(Int(number)) : String(number)
	}
}

enum FlowStepInputLayout {
	/// Required inputs first, then the rest by name.
	static func specs(catalogTool: FlowCatalogTool?, scriptTool: UserScriptTool?) -> [FlowStepInputSpec] {
		if let catalogTool {
			let properties = catalogTool.inputSchema.properties ?? [:]
			let required = Set(catalogTool.requiredFields)
			var seen = Set<String>()
			let keys = (catalogTool.requiredFields + properties.keys.sorted()).filter { seen.insert($0).inserted }
			return keys.map { FlowStepInputSpec(key: $0, property: properties[$0], isRequired: required.contains($0)) }
		}
		if let scriptTool {
			return scriptTool.inputNames.map { FlowStepInputSpec(key: $0, property: nil, isRequired: true) }
		}
		return []
	}

	static func isSet(_ key: String, in node: FlowEditorNode) -> Bool {
		if node.triggerInputs[key] != nil || node.outputInputs[key] != nil { return true }
		return !(node.constInputs[key]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
	}

	/// Inputs that stay visible while "More options" is closed: required ones,
	/// ones with a value, and ones that had a value while the card was open
	/// (so clearing a field doesn't make it vanish mid-edit).
	static func primaryKeys(specs: [FlowStepInputSpec], node: FlowEditorNode, pinned: Set<String>) -> [String] {
		specs.filter { $0.isRequired || pinned.contains($0.key) || isSet($0.key, in: node) }.map(\.key)
	}

	/// "Background, Compression level, Lossless +2".
	static func hiddenHint(_ hidden: [FlowStepInputSpec]) -> String {
		let names = hidden.prefix(3).map(\.label).joined(separator: ", ")
		return hidden.count > 3 ? "\(names) +\(hidden.count - 3)" : names
	}

	/// One line for a collapsed step: "Image: The new file · Convert to: JPEG".
	static func summary(
		specs: [FlowStepInputSpec],
		node: FlowEditorNode,
		triggerValues: [FlowTriggerValue],
		outputs: [FlowStepOutputOption]
	) -> String? {
		let parts: [String] = specs.compactMap { spec in
			guard let value = displayValue(spec, node: node, triggerValues: triggerValues, outputs: outputs) else { return nil }
			return "\(spec.label): \(value)"
		}
		guard !parts.isEmpty else { return nil }
		let shown = parts.prefix(3).joined(separator: " · ")
		return parts.count > 3 ? "\(shown) +\(parts.count - 3)" : shown
	}

	static func displayValue(
		_ spec: FlowStepInputSpec,
		node: FlowEditorNode,
		triggerValues: [FlowTriggerValue],
		outputs: [FlowStepOutputOption]
	) -> String? {
		if let path = node.triggerInputs[spec.key] {
			return triggerValues.first(where: { $0.path == path })?.label ?? "Trigger"
		}
		if let link = node.outputInputs[spec.key] {
			return outputs.first(where: { $0.key == link.from })?.title ?? link.from
		}
		let raw = node.constInputs[spec.key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		guard !raw.isEmpty else { return nil }
		switch spec.kind {
		case .toggle:
			return raw.lowercased() == "true" ? "On" : "Off"
		case .choice:
			return spec.choiceLabel(for: raw)
		case .text, .number:
			return raw.count > 28 ? String(raw.prefix(27)) + "…" : raw
		}
	}
}

extension FlowEditorText {
	private static let knownChoiceLabels = [
		"jpeg": "JPEG", "jpg": "JPG", "png": "PNG", "webp": "WebP", "gif": "GIF", "heic": "HEIC",
		"pdf": "PDF", "svg": "SVG", "csv": "CSV", "json": "JSON", "html": "HTML", "url": "URL",
	]

	/// "jpeg" → "JPEG", "contain" → "Contain", "dueDate" → "Due date".
	static func choiceLabel(_ value: String) -> String {
		if let known = knownChoiceLabels[value.lowercased()] { return known }
		if Double(value) != nil { return value }
		return ToolDisplayLabels.displayLabel(value)
	}
}

// MARK: - Views

/// A step's inputs: the ones that matter, with the rest behind "More options".
struct FlowEditorStepInputs: View {
	@Binding var node: FlowEditorNode
	let specs: [FlowStepInputSpec]
	let triggerValues: [FlowTriggerValue]
	let outputs: [FlowStepOutputOption]

	@State private var showsAll = false
	@State private var pinned: Set<String> = []

	var body: some View {
		let primary = Set(FlowStepInputLayout.primaryKeys(specs: specs, node: node, pinned: pinned))
		let hidden = specs.filter { !primary.contains($0.key) }
		VStack(alignment: .leading, spacing: 4) {
			ForEach(specs.filter { showsAll || primary.contains($0.key) }) { spec in
				FlowEditorInputField(node: $node, spec: spec, triggerValues: triggerValues, outputs: outputs)
			}
			if !hidden.isEmpty {
				Button {
					withAnimation(.easeOut(duration: 0.2)) { showsAll.toggle() }
				} label: {
					HStack(spacing: 6) {
						Image(systemName: "chevron.right")
							.font(.system(size: 9, weight: .bold))
							.rotationEffect(.degrees(showsAll ? 90 : 0))
							.foregroundStyle(AppTheme.accent)
						Text(showsAll ? "Fewer options" : "More options")
							.foregroundStyle(AppTheme.accent)
						if !showsAll {
							Text(FlowStepInputLayout.hiddenHint(hidden))
								.foregroundStyle(AppTheme.tertiaryText)
								.lineLimit(1)
						}
					}
					.font(.system(size: 12))
					.frame(minHeight: 26)
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
				.padding(.top, 2)
				.accessibilityLabel(showsAll ? "Fewer options" : "More options: \(FlowStepInputLayout.hiddenHint(hidden))")
				.accessibilityIdentifier("flow-editor-more-options-\(node.id)")
			}
		}
		.onAppear(perform: pinSetInputs)
		.onChange(of: node) { _, _ in pinSetInputs() }
	}

	private func pinSetInputs() {
		for spec in specs where !pinned.contains(spec.key) && FlowStepInputLayout.isSet(spec.key, in: node) {
			pinned.insert(spec.key)
		}
	}
}

/// One input row: a typed control, or a pill when the value comes from the
/// trigger or an earlier step. The link button on the right switches between
/// them, replacing the old per-input "Source for …" picker.
struct FlowEditorInputField: View {
	@Binding var node: FlowEditorNode
	let spec: FlowStepInputSpec
	let triggerValues: [FlowTriggerValue]
	let outputs: [FlowStepOutputOption]

	@State private var isHovering = false
	@State private var editsOutputPath = false

	private var key: String { spec.key }
	private var triggerPath: String? { node.triggerInputs[key] }
	private var outputLink: FlowEditorOutputInput? { node.outputInputs[key] }
	private var isLinked: Bool { triggerPath != nil || outputLink != nil }

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(alignment: .center, spacing: 10) {
				Text(spec.label)
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowTitle)
					.lineLimit(1)
					.frame(width: 110, alignment: .leading)
					.help(spec.help ?? "")
				value
					.frame(maxWidth: .infinity, alignment: .leading)
				linkMenu
			}
			.frame(minHeight: 30)
			if showsOutputPath {
				TextField("Field path, for example markdown", text: outputPathBinding)
					.textFieldStyle(.roundedBorder)
					.font(.system(size: 11, design: .monospaced))
					.padding(.leading, 120)
					.padding(.trailing, 34)
					.accessibilityLabel("Field path for \(spec.label)")
			}
		}
		.contentShape(Rectangle())
		.onHover { isHovering = $0 }
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("flow-editor-input-\(key)")
	}

	// MARK: Value

	@ViewBuilder
	private var value: some View {
		if let triggerPath {
			if let known = triggerValues.first(where: { $0.path == triggerPath }) {
				FlowEditorValuePill(label: known.label, detail: "trigger", systemImage: known.systemImage, onClear: clearLink)
			} else {
				HStack(spacing: 6) {
					Text("Trigger")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(AppTheme.accent)
					TextField("event.payload.…", text: triggerPathBinding)
						.textFieldStyle(.roundedBorder)
						.font(.system(size: 11, design: .monospaced))
						.accessibilityLabel("Trigger path for \(spec.label)")
				}
			}
		} else if let outputLink {
			if let option = outputs.first(where: { $0.key == outputLink.from }) {
				FlowEditorValuePill(
					label: option.title,
					detail: customPath(outputLink, option: option).map { "› \($0)" },
					systemImage: option.systemImage,
					onClear: clearLink
				)
			} else {
				FlowEditorValuePill(
					label: "Step was removed",
					detail: nil,
					systemImage: "exclamationmark.triangle",
					isProblem: true,
					onClear: clearLink
				)
			}
		} else {
			typedControl
		}
	}

	@ViewBuilder
	private var typedControl: some View {
		switch spec.kind {
		case .toggle:
			HStack(spacing: 8) {
				Toggle(spec.label, isOn: Binding(
					get: {
						let raw = node.constInputs[key] ?? ""
						return raw.isEmpty ? spec.property?.defaultValue == "true" : raw.lowercased() == "true"
					},
					set: { node.constInputs[key] = $0 ? "true" : "false" }
				))
				.labelsHidden()
				.toggleStyle(.switch)
				.controlSize(.small)
				.tint(SettingsDesign.toggleTint)
			}
		case let .choice(choices):
			Picker(spec.label, selection: constBinding) {
				if spec.isRequired {
					if (node.constInputs[key] ?? "").isEmpty {
						Text("Choose…").tag("")
					}
				} else if let defaultValue = spec.property?.defaultValue, !defaultValue.isEmpty {
					Text(spec.choiceLabel(for: defaultValue)).tag("")
				} else {
					Text("Automatic").tag("")
				}
				ForEach(choices.filter { $0.value != spec.property?.defaultValue || spec.isRequired }, id: \.value) { choice in
					Text(choice.label).tag(choice.value)
				}
				if let current = node.constInputs[key], !current.isEmpty, !choices.contains(where: { $0.value == current }) {
					Text(current).tag(current)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.fixedSize()
		case .number:
			HStack(spacing: 8) {
				TextField(spec.placeholder, text: constBinding)
					.textFieldStyle(.roundedBorder)
					.frame(width: 72)
					.accessibilityLabel(spec.label)
				if let range = spec.rangeHint {
					Text(range)
						.font(.system(size: 12))
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
		case .text:
			TextField(spec.placeholder, text: constBinding)
				.textFieldStyle(.roundedBorder)
				.accessibilityLabel(spec.label)
		}
	}

	// MARK: Link menu

	private var linkMenu: some View {
		Menu {
			if !triggerValues.isEmpty {
				Section("From the trigger") {
					ForEach(triggerValues) { option in
						Button {
							link(triggerPath: option.path)
						} label: {
							if triggerPath == option.path {
								Label(option.label, systemImage: "checkmark")
							} else {
								Text(option.label)
							}
						}
					}
				}
			}
			Section("From an earlier step") {
				if outputs.isEmpty {
					Button("No earlier steps yet") {}
						.disabled(true)
				}
				ForEach(outputs) { option in
					Button {
						link(output: option)
					} label: {
						if outputLink?.from == option.key {
							Label(option.title, systemImage: "checkmark")
						} else {
							Text(option.title)
						}
					}
				}
			}
			Divider()
			Button("Type a value", action: clearLink)
				.disabled(!isLinked)
			if outputLink != nil {
				Button("Use a field from it…") { editsOutputPath = true }
			}
			Button("Custom trigger path…") { link(triggerPath: "event.payload.") }
		} label: {
			Image(systemName: "link")
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(isLinked ? AppTheme.accent : AppTheme.secondaryText)
				.frame(width: 24, height: 24)
				.contentShape(Rectangle())
		}
		.menuStyle(.borderlessButton)
		.menuIndicator(.hidden)
		.fixedSize()
		.opacity(isLinked || isHovering ? 1 : 0.35)
		.help("Use a value from the trigger or an earlier step")
		.accessibilityLabel("Use a value for \(spec.label) from the trigger or an earlier step")
		.accessibilityIdentifier("flow-editor-link-\(key)")
	}

	// MARK: Mutations

	private func link(triggerPath path: String) {
		node.outputInputs.removeValue(forKey: key)
		node.triggerInputs[key] = path
		editsOutputPath = false
	}

	private func link(output option: FlowStepOutputOption) {
		node.triggerInputs.removeValue(forKey: key)
		node.outputInputs[key] = FlowEditorOutputInput(from: option.key, path: option.textPath)
	}

	private func clearLink() {
		node.triggerInputs.removeValue(forKey: key)
		node.outputInputs.removeValue(forKey: key)
		editsOutputPath = false
	}

	private var showsOutputPath: Bool {
		guard let outputLink else { return false }
		guard let option = outputs.first(where: { $0.key == outputLink.from }) else { return outputLink.path != nil }
		return editsOutputPath || customPath(outputLink, option: option) != nil
	}

	/// The link's path when it differs from the output's usual text path.
	private func customPath(_ link: FlowEditorOutputInput, option: FlowStepOutputOption) -> String? {
		guard let path = link.path, !path.isEmpty, path != option.textPath else { return nil }
		return path
	}

	private var constBinding: Binding<String> {
		Binding(
			get: { node.constInputs[key] ?? "" },
			set: { node.constInputs[key] = $0 }
		)
	}

	private var triggerPathBinding: Binding<String> {
		Binding(
			get: { node.triggerInputs[key] ?? "" },
			set: { node.triggerInputs[key] = $0 }
		)
	}

	private var outputPathBinding: Binding<String> {
		Binding(
			get: { node.outputInputs[key]?.path ?? "" },
			set: { path in
				guard let from = node.outputInputs[key]?.from else { return }
				node.outputInputs[key] = FlowEditorOutputInput(from: from, path: path.isEmpty ? nil : path)
			}
		)
	}
}

/// A linked value: "The new file  trigger  ×".
struct FlowEditorValuePill: View {
	let label: String
	let detail: String?
	let systemImage: String
	var isProblem = false
	let onClear: () -> Void

	private var tint: Color { isProblem ? AppTheme.statusErrorForeground : AppTheme.accent }

	var body: some View {
		HStack(spacing: 6) {
			Image(systemName: systemImage)
				.font(.system(size: 11, weight: .medium))
				.accessibilityHidden(true)
			Text(label)
				.font(.system(size: 12, weight: .medium))
				.lineLimit(1)
			if let detail {
				Text(detail)
					.font(.system(size: 12))
					.foregroundStyle(tint.opacity(0.7))
					.lineLimit(1)
			}
			Button(action: onClear) {
				Image(systemName: "xmark")
					.font(.system(size: 8, weight: .bold))
					.frame(width: 14, height: 14)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Stop using \(label)")
		}
		.foregroundStyle(tint)
		.padding(.leading, 8)
		.padding(.trailing, 5)
		.frame(height: 24)
		.background(
			RoundedRectangle(cornerRadius: 6, style: .continuous)
				.fill(isProblem ? AppTheme.statusErrorBackground : AppTheme.accent.opacity(0.13))
		)
		.accessibilityElement(children: .contain)
	}
}
