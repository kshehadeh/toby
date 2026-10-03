import SwiftUI

// MARK: - Model

struct FlowToolPickerRow: Identifiable, Equatable {
	enum Choice: Equatable {
		case catalog(FlowCatalogTool)
		case script(UserScriptTool)
	}

	let id: String
	let title: String
	let description: String?
	let systemImage: String
	let choice: Choice
}

struct FlowToolPickerSection: Identifiable, Equatable {
	enum Kind: Equatable {
		case scriptTools
		case integration(iconURL: URL?, connected: Bool)
	}

	let id: String
	let title: String
	let kind: Kind
	let rows: [FlowToolPickerRow]
}

/// Builds the "Choose a tool" list: Script Tools first, then integrations
/// (connected before not connected, then by name), each tool with an icon
/// for what it does. A query matches tool names, descriptions and the
/// integration's name.
enum FlowToolPickerModel {
	static func sections(
		scriptTools: [UserScriptTool],
		modules: [FlowCatalogModule],
		query: String
	) -> [FlowToolPickerSection] {
		let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		var sections: [FlowToolPickerSection] = []

		let scriptRows = scriptTools
			.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
			.filter { tool in
				matches(needle, section: "Script Tools", fields: [tool.name, tool.description])
			}
			.map { tool in
				let description = tool.description.trimmingCharacters(in: .whitespacesAndNewlines)
				return FlowToolPickerRow(
					id: "script-\(tool.id)",
					title: tool.name,
					description: description.isEmpty ? nil : description,
					systemImage: "curlybraces",
					choice: .script(tool)
				)
			}
		if !scriptRows.isEmpty {
			sections.append(FlowToolPickerSection(id: "script-tools", title: "Script Tools", kind: .scriptTools, rows: scriptRows))
		}

		let orderedModules = modules
			.filter { !$0.tools.isEmpty }
			.sorted { lhs, rhs in
				if lhs.connected != rhs.connected { return lhs.connected }
				return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
			}
		for module in orderedModules {
			let rows = module.tools
				.sorted { lhs, rhs in
					let lhsSummary = lhs.standardTool != nil
					let rhsSummary = rhs.standardTool != nil
					if lhsSummary != rhsSummary { return lhsSummary }
					return lhs.label.localizedCaseInsensitiveCompare(rhs.label) == .orderedAscending
				}
				.filter { tool in
					matches(needle, section: module.displayName, fields: [tool.label, tool.toolName, tool.description ?? ""])
				}
				.map { tool in
					FlowToolPickerRow(
						id: "tool-\(tool.id)",
						title: tool.label,
						description: FlowEditorText.firstSentence(tool.description),
						systemImage: actionSymbol(for: tool),
						choice: .catalog(tool)
					)
				}
			guard !rows.isEmpty else { continue }
			sections.append(FlowToolPickerSection(
				id: "module-\(module.name)",
				title: module.displayName,
				kind: .integration(iconURL: module.resolvedIconURL, connected: module.connected),
				rows: rows
			))
		}
		return sections
	}

	/// SF Symbol for what a tool does, read from the verb its name starts
	/// with (`searchCalendarEvents` → magnifying glass).
	static func actionSymbol(for tool: FlowCatalogTool) -> String {
		let name = tool.toolName
		let lower = name.lowercased()
		if tool.standardTool != nil || lower.contains("summary") {
			return "text.alignleft"
		}
		let verb = String(name.prefix(while: { $0.isLowercase })).lowercased()
		switch verb {
		case "list": return "list.bullet"
		case "search", "find", "query", "lookup": return "magnifyingglass"
		case "get", "read", "fetch", "show", "view": return "doc.text"
		case "create", "add", "new", "insert", "make": return "plus.circle"
		case "update", "edit", "set", "rename", "move", "change": return "pencil"
		case "delete", "remove", "trash", "clear": return "trash"
		case "send", "post", "reply", "forward", "share": return "paperplane"
		case "complete", "close", "finish": return "checkmark.circle"
		case "open", "launch", "run": return "arrow.up.forward.app"
		default: return ToolDisplayLabels.iconForTool(name)
		}
	}

	static func rowCount(_ sections: [FlowToolPickerSection]) -> Int {
		sections.reduce(0) { $0 + $1.rows.count }
	}

	private static func matches(_ needle: String, section: String, fields: [String]) -> Bool {
		guard !needle.isEmpty else { return true }
		if section.lowercased().contains(needle) { return true }
		return fields.contains { $0.lowercased().contains(needle) }
	}
}

// MARK: - View

struct FlowToolPickerView: View {
	@Bindable var store: FlowsStore
	let onPick: (FlowCatalogTool) -> Void
	let onPickUserTool: (UserScriptTool) -> Void
	@Environment(\.dismiss) private var dismiss
	@State private var query = ""
	@State private var scriptTools: [UserScriptTool] = []
	@State private var isLoading = true
	@FocusState private var isSearchFocused: Bool

	private var sections: [FlowToolPickerSection] {
		FlowToolPickerModel.sections(
			scriptTools: scriptTools,
			modules: store.catalog?.modules ?? [],
			query: query
		)
	}

	private var hasAnyTools: Bool {
		!scriptTools.isEmpty || (store.catalog?.modules.contains { !$0.tools.isEmpty } ?? false)
	}

	var body: some View {
		let visibleSections = self.sections
		VStack(spacing: 0) {
			header(count: FlowToolPickerModel.rowCount(visibleSections))
			ScrollView {
				content(visibleSections)
					.padding(.horizontal, 12)
					.padding(.top, 6)
					.padding(.bottom, 16)
			}
			footer
		}
		.background(SettingsDesign.canvasBackground)
		.frame(minWidth: 520, idealWidth: 560, minHeight: 560, idealHeight: 680)
		.accessibilityIdentifier("flow-tool-picker")
		.onAppear { isSearchFocused = true }
		.task {
			await store.loadCatalog()
			scriptTools = (try? await TobyClient().listUserScriptTools()) ?? []
			isLoading = false
		}
	}

	private func header(count: Int) -> some View {
		VStack(alignment: .leading, spacing: 14) {
			VStack(alignment: .leading, spacing: 3) {
				Text("Choose a tool")
					.font(.system(size: 15, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text("Pick what this step should look up or do.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
			}

			HStack(spacing: 9) {
				Image(systemName: "magnifyingglass")
					.font(.system(size: 14, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
					.accessibilityHidden(true)
				TextField("Search tools and integrations", text: $query)
					.textFieldStyle(.plain)
					.font(.system(size: 14))
					.focused($isSearchFocused)
					.onSubmit(pickFirstMatch)
					.accessibilityIdentifier("flow-tool-picker-search")
				if !isLoading {
					Text(countLabel(count))
						.font(.system(size: 12))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
				if !query.isEmpty {
					Button {
						query = ""
					} label: {
						Image(systemName: "xmark.circle.fill")
							.foregroundStyle(AppTheme.tertiaryText)
					}
					.buttonStyle(.plain)
					.accessibilityLabel("Clear search")
				}
			}
			.padding(.horizontal, 12)
			.frame(height: 38)
			.background(SettingsDesign.canvasBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
			.overlay {
				RoundedRectangle(cornerRadius: 10, style: .continuous)
					.strokeBorder(isSearchFocused ? AppTheme.accent.opacity(0.55) : SettingsDesign.controlBorder, lineWidth: 1)
			}
			.overlay {
				if isSearchFocused {
					RoundedRectangle(cornerRadius: 12, style: .continuous)
						.stroke(AppTheme.accent.opacity(0.22), lineWidth: 3)
						.padding(-2)
				}
			}
		}
		.padding(.horizontal, 20)
		.padding(.top, 20)
		.padding(.bottom, 16)
		.background(SettingsDesign.cardBackground)
		.overlay(alignment: .bottom) {
			Rectangle()
				.fill(SettingsDesign.cardBorder)
				.frame(height: 1)
		}
	}

	@ViewBuilder
	private func content(_ sections: [FlowToolPickerSection]) -> some View {
		if isLoading && !hasAnyTools {
			ProgressView("Loading tools…")
				.controlSize(.small)
				.frame(maxWidth: .infinity)
				.padding(.vertical, 72)
		} else if !hasAnyTools {
			FlowToolPickerMessage(
				systemImage: "wrench.and.screwdriver",
				title: "No tools yet",
				detail: store.editorError?.isEmpty == false
					? (store.editorError ?? "")
					: "Connect an app in Settings › Integrations, or write a script tool in Flows › Script Tools."
			)
		} else if sections.isEmpty {
			FlowToolPickerMessage(
				systemImage: "magnifyingglass",
				title: "No tools match “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”",
				detail: "Try another word, or connect more apps in Settings › Integrations."
			)
		} else {
			LazyVStack(alignment: .leading, spacing: 0) {
				ForEach(sections) { section in
					FlowToolPickerSectionView(section: section) { row in
						pick(row)
					}
					.padding(.top, 12)
				}
			}
		}
	}

	private var footer: some View {
		HStack {
			Text("Script tools you write live in Flows › Script Tools.")
				.font(.system(size: 12))
				.foregroundStyle(AppTheme.tertiaryText)
			Spacer(minLength: 12)
			Button("Cancel") { dismiss() }
				.keyboardShortcut(.cancelAction)
		}
		.padding(.horizontal, 20)
		.frame(height: 56)
		.background(SettingsDesign.cardBackground)
		.overlay(alignment: .top) {
			Rectangle()
				.fill(SettingsDesign.cardBorder)
				.frame(height: 1)
		}
	}

	private func countLabel(_ count: Int) -> String {
		if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return count == 1 ? "1 tool" : "\(count) tools"
		}
		return count == 1 ? "1 match" : "\(count) matches"
	}

	private func pickFirstMatch() {
		guard let row = sections.first?.rows.first else { return }
		pick(row)
	}

	private func pick(_ row: FlowToolPickerRow) {
		switch row.choice {
		case .catalog(let tool): onPick(tool)
		case .script(let tool): onPickUserTool(tool)
		}
		dismiss()
	}
}

private struct FlowToolPickerSectionView: View {
	let section: FlowToolPickerSection
	let onPick: (FlowToolPickerRow) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 8) {
				badge
				Text(section.title)
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text("\(section.rows.count)")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
				if case .integration(_, let connected) = section.kind, !connected {
					Text("Not connected")
						.font(.system(size: 9, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(.horizontal, 5)
						.padding(.vertical, 1)
						.background(Capsule().fill(AppTheme.primaryText.opacity(0.08)))
				}
			}
			.padding(.horizontal, 8)
			.accessibilityElement(children: .combine)
			.accessibilityAddTraits(.isHeader)

			let shape = AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
			VStack(alignment: .leading, spacing: 0) {
				ForEach(section.rows) { row in
					FlowToolPickerRowView(row: row) { onPick(row) }
				}
			}
			.padding(4)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(SettingsDesign.cardBackground, in: shape)
			.overlay {
				shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
		}
		.accessibilityIdentifier("flow-tool-picker-section-\(section.id)")
	}

	@ViewBuilder
	private var badge: some View {
		switch section.kind {
		case .scriptTools:
			Image(systemName: "curlybraces")
				.font(.system(size: 9, weight: .bold))
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 18, height: 18)
				.background(AppTheme.primaryText.opacity(0.06), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
				.accessibilityHidden(true)
		case .integration(let iconURL, _):
			Group {
				if let iconURL {
					AsyncImage(url: iconURL) { phase in
						switch phase {
						case .success(let image):
							image
								.resizable()
								.scaledToFit()
						default:
							Image(systemName: "puzzlepiece")
								.font(.system(size: 9, weight: .semibold))
								.foregroundStyle(AppTheme.secondaryText)
						}
					}
				} else {
					Image(systemName: "puzzlepiece")
						.font(.system(size: 9, weight: .semibold))
						.foregroundStyle(AppTheme.secondaryText)
				}
			}
			.frame(width: 18, height: 18)
			.background(Color.white, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
			.clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
			.accessibilityHidden(true)
		}
	}
}

private struct FlowToolPickerRowView: View {
	let row: FlowToolPickerRow
	let action: () -> Void
	@State private var isHovered = false

	var body: some View {
		Button(action: action) {
			HStack(alignment: .top, spacing: 12) {
				Image(systemName: row.systemImage)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.frame(width: 30, height: 30)
					.background(AppTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
					.accessibilityHidden(true)
				VStack(alignment: .leading, spacing: 2) {
					Text(row.title)
						.font(.system(size: 13, weight: .medium))
						.foregroundStyle(SettingsDesign.rowTitle)
					if let description = row.description {
						Text(description)
							.font(.system(size: 12))
							.foregroundStyle(SettingsDesign.rowDescription)
							.lineLimit(2)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
				.padding(.top, 1)
				Spacer(minLength: 0)
			}
			.padding(.horizontal, 10)
			.padding(.vertical, 9)
			.background(
				RoundedRectangle(cornerRadius: 7, style: .continuous)
					.fill(isHovered ? AppTheme.selection : Color.clear)
			)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.accessibilityLabel([row.title, row.description].compactMap { $0 }.joined(separator: ", "))
		.accessibilityIdentifier("flow-tool-picker-row-\(row.id)")
	}
}

private struct FlowToolPickerMessage: View {
	let systemImage: String
	let title: String
	let detail: String

	var body: some View {
		VStack(spacing: 6) {
			Image(systemName: systemImage)
				.font(.system(size: 24, weight: .light))
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.bottom, 4)
				.accessibilityHidden(true)
			Text(title)
				.font(.system(size: 13, weight: .medium))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text(detail)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
		}
		.frame(maxWidth: .infinity)
		.padding(.horizontal, 24)
		.padding(.vertical, 72)
	}
}
