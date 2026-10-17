import Foundation

/// Where a tool step is in its lifecycle. Every renderer shares these states.
enum ToolStepPhase: Equatable {
	/// Started, args not received yet.
	case pending
	case running
	case done
	case cached
	case failed
}

/// Everything a renderer may read about one tool call.
struct ToolStepContext {
	let toolName: String
	let integrationLabel: String?
	let args: [String: ToolArgValue]
	let presentation: ToolPresentation?
	let progress: ToolStepProgress?
	let phase: ToolStepPhase
	/// Completed result line (core summary or generic output formatter).
	let resultSummary: String
	/// Pre-renderer title (`formatToolCallHeader`), used when nothing better exists.
	let fallbackTitle: String
}

/// A small capsule describing one argument the model supplied.
struct ToolArgChip: Identifiable, Equatable {
	let id: String
	/// Faint key prefix for generic `key: value` chips.
	let key: String?
	let text: String
	let systemImage: String?
	/// Literal model input (queries, paths) renders monospaced.
	let isLiteral: Bool
}

/// Maps one tool call to the pieces of its transcript step. Renderers are
/// pure value transforms; `ToolStepRow` owns layout so every tool shares the
/// same anatomy (glyph, title, chips, live rail, summary, meta).
protocol ToolStepRenderer {
	func title(_ context: ToolStepContext) -> String
	func chips(_ context: ToolStepContext) -> [ToolArgChip]
	func liveItems(_ context: ToolStepContext) -> [ToolProgressItem]
	func summary(_ context: ToolStepContext) -> String
	func systemImage(_ context: ToolStepContext) -> String
	/// Argument keys shown as chips when the presentation doesn't list them.
	var defaultChipKeys: [String] { get }
	/// Verbs used when the presentation doesn't supply any.
	var defaultVerbs: (running: String, done: String)? { get }
}

extension ToolStepRenderer {
	var defaultChipKeys: [String] { [] }
	var defaultVerbs: (running: String, done: String)? { nil }

	func title(_ context: ToolStepContext) -> String {
		let verb: String?
		switch context.phase {
		case .pending, .running:
			verb = context.presentation?.runningVerb ?? defaultVerbs?.running
		case .done, .cached, .failed:
			verb = context.presentation?.doneVerb ?? defaultVerbs?.done
		}
		guard let verb else {
			// No verb: drop the inline " · “query”" suffix when chips show it.
			if chips(context).isEmpty {
				return ToolStepTitle.strippingCorePrefix(context.fallbackTitle)
			}
			return ToolStepTitle.prefixed(
				ToolDisplayLabels.displayLabel(context.toolName),
				integrationLabel: context.integrationLabel,
			)
		}
		return ToolStepTitle.prefixed(verb, integrationLabel: context.integrationLabel)
	}

	func chips(_ context: ToolStepContext) -> [ToolArgChip] {
		let keys = context.presentation?.argChips ?? defaultChipKeys
		let primary = context.presentation?.primaryArg
		return ToolArgChipBuilder.chips(
			for: keys,
			args: context.args,
			literalKeys: Set([primary].compactMap { $0 }).union(ToolArgChipBuilder.literalKeys),
		)
	}

	func liveItems(_ context: ToolStepContext) -> [ToolProgressItem] {
		switch context.phase {
		case .running, .pending, .failed:
			return context.progress?.items ?? []
		case .done, .cached:
			return []
		}
	}

	func summary(_ context: ToolStepContext) -> String {
		switch context.phase {
		case .pending, .running:
			return ""
		case .done, .cached, .failed:
			let trimmed = context.resultSummary.trimmingCharacters(in: .whitespacesAndNewlines)
			return ToolStepTitle.placeholderSummaries.contains(trimmed) ? "" : trimmed
		}
	}

	func systemImage(_ context: ToolStepContext) -> String {
		ToolDisplayLabels.iconForTool(context.toolName)
	}
}

enum ToolStepTitle {
	/// Core tools are labelled "Toby"; prefixing every step with it is noise.
	static let coreIntegrationLabel = "Toby"

	/// Generic results that say nothing beyond "it finished".
	static let placeholderSummaries: Set<String> = [
		"Done.",
		"Done. Cached result.",
		"No result.",
		"Running…",
	]

	static func prefixed(_ title: String, integrationLabel: String?) -> String {
		guard let integrationLabel, !integrationLabel.isEmpty,
		      integrationLabel != coreIntegrationLabel,
		      !title.hasPrefix("\(integrationLabel):")
		else { return title }
		return "\(integrationLabel): \(title)"
	}

	static func strippingCorePrefix(_ title: String) -> String {
		let prefix = "\(coreIntegrationLabel): "
		return title.hasPrefix(prefix) ? String(title.dropFirst(prefix.count)) : title
	}
}

/// Housekeeping tools whose finished steps carry no information for the user.
enum ToolStepTransience {
	/// Fallback for transcripts saved before presentations carried `transient`.
	/// Mirrors the transient entries in core's `CORE_TOOL_PRESENTATIONS`.
	static let legacyTransientTools: Set<String> = [
		"enableTools",
		"tobyListTools",
		"tobyListIntegrations",
		"tobyListSkills",
		"tobyListDefaults",
		"tobyInstanceInfo",
		"getCurrentDateTime",
		"loadLocalSkillInstructions",
		"listFlowAuthoringCatalog",
		"memoryRetrieveForTask",
	]

	static func isTransient(toolName: String?, presentation: ToolPresentation?) -> Bool {
		if let transient = presentation?.transient { return transient }
		guard let toolName else { return false }
		return legacyTransientTools.contains(toolName)
	}
}

enum ToolArgChipBuilder {
	static let maxChips = 4
	static let literalKeys: Set<String> = ["query", "q", "queries", "path", "url", "file"]

	private static let keyIcons: [String: String] = [
		"due": "calendar",
		"dueString": "calendar",
		"date": "calendar",
		"since": "calendar",
		"start": "calendar",
		"end": "calendar",
		"search_recency_filter": "clock",
		"recency": "clock",
		"country": "globe",
		"location": "mappin",
		"project": "number",
		"projectId": "number",
		"priority": "flag",
		"limit": "line.3.horizontal.decrease",
		"max_results": "line.3.horizontal.decrease",
	]

	private static let recencyLabels: [String: String] = [
		"day": "past day",
		"week": "past week",
		"month": "past month",
		"year": "past year",
	]

	/// Generic chips: preferred subject keys first, then alphabetical scalars.
	static let genericKeyOrder = ["query", "q", "path", "url", "title", "name", "id", "taskId"]

	static func chips(
		for keys: [String],
		args: [String: ToolArgValue],
		literalKeys: Set<String>,
	) -> [ToolArgChip] {
		var chips: [ToolArgChip] = []
		for key in keys {
			guard let value = args[key] else { continue }
			let icon = keyIcons[key]
			let isLiteral = literalKeys.contains(key)
			switch value {
			case .list(let values):
				for (index, item) in values.enumerated() {
					chips.append(ToolArgChip(
						id: "\(key)-\(index)",
						key: nil,
						text: item,
						systemImage: icon,
						isLiteral: isLiteral,
					))
				}
			case .bool(let flag):
				chips.append(ToolArgChip(
					id: key,
					key: "\(key): ",
					text: flag ? "true" : "false",
					systemImage: nil,
					isLiteral: false,
				))
			default:
				let text = key == "search_recency_filter"
					? recencyLabels[value.displayText] ?? value.displayText
					: value.displayText
				let showsKey = icon == nil && !isLiteral
				chips.append(ToolArgChip(
					id: key,
					key: showsKey ? "\(key): " : nil,
					text: text,
					systemImage: icon,
					isLiteral: isLiteral,
				))
			}
		}
		return collapseOverflow(chips)
	}

	/// Keeps the row to one line: the first few chips plus a `+n` chip.
	static func collapseOverflow(_ chips: [ToolArgChip]) -> [ToolArgChip] {
		guard chips.count > maxChips else { return chips }
		let shown = chips.prefix(maxChips - 1)
		let overflow = ToolArgChip(
			id: "overflow",
			key: nil,
			text: "+\(chips.count - shown.count)",
			systemImage: nil,
			isLiteral: false,
		)
		return Array(shown) + [overflow]
	}
}

// MARK: - Built-in renderers (one per presentation kind)

struct SearchStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["query", "q", "queries"] }
	func systemImage(_ context: ToolStepContext) -> String {
		let icon = ToolDisplayLabels.iconForTool(context.toolName)
		return icon == ToolDisplayLabels.defaultToolIcon ? "magnifyingglass" : icon
	}
}

struct WebSearchStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["query", "search_recency_filter", "country"] }
	var defaultVerbs: (running: String, done: String)? { ("Searching the web", "Searched the web") }
	func systemImage(_ context: ToolStepContext) -> String { "globe" }
}

struct ReadStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["path", "url", "file", "id"] }
	func systemImage(_ context: ToolStepContext) -> String {
		let icon = ToolDisplayLabels.iconForTool(context.toolName)
		return icon == ToolDisplayLabels.defaultToolIcon ? "doc.text" : icon
	}
}

struct WriteStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["path", "file", "title", "name"] }
	func systemImage(_ context: ToolStepContext) -> String { "square.and.pencil" }
}

struct ListStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["project", "since", "start", "end", "limit"] }
	func systemImage(_ context: ToolStepContext) -> String {
		let icon = ToolDisplayLabels.iconForTool(context.toolName)
		return icon == ToolDisplayLabels.defaultToolIcon ? "list.bullet" : icon
	}
}

struct FetchStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["url", "location"] }
	func systemImage(_ context: ToolStepContext) -> String {
		let icon = ToolDisplayLabels.iconForTool(context.toolName)
		return icon == ToolDisplayLabels.defaultToolIcon ? "arrow.down.circle" : icon
	}
}

struct ActionStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["title", "name", "content", "id"] }
}

struct AgentStepRenderer: ToolStepRenderer {
	var defaultChipKeys: [String] { ["task", "goal"] }
	func systemImage(_ context: ToolStepContext) -> String { "list.bullet.indent" }
}

/// Fallback for tools without a presentation: humanized label plus up to
/// three `key: value` chips, and today's generic output summary.
struct GenericStepRenderer: ToolStepRenderer {
	func chips(_ context: ToolStepContext) -> [ToolArgChip] {
		let preferred = ToolArgChipBuilder.genericKeyOrder.filter { context.args[$0] != nil }
		let rest = context.args.keys
			.filter { !preferred.contains($0) }
			.sorted()
		let keys = Array((preferred + rest).prefix(3))
		return ToolArgChipBuilder.chips(
			for: keys,
			args: context.args,
			literalKeys: ToolArgChipBuilder.literalKeys,
		)
	}
}

// MARK: - Registry

/// Resolves the renderer for a tool step: exact tool name, then presentation
/// kind, then the generic renderer. Register name overrides for tools that
/// need bespoke formatting beyond what their presentation describes.
@MainActor
enum ToolStepRendererRegistry {
	private static var byToolName: [String: any ToolStepRenderer] = [
		"webSearch": WebSearchStepRenderer(),
	]

	private static let byKind: [ToolPresentationKind: any ToolStepRenderer] = [
		.search: SearchStepRenderer(),
		.read: ReadStepRenderer(),
		.write: WriteStepRenderer(),
		.list: ListStepRenderer(),
		.fetch: FetchStepRenderer(),
		.action: ActionStepRenderer(),
		.agent: AgentStepRenderer(),
		.generic: GenericStepRenderer(),
	]

	static func register(_ renderer: any ToolStepRenderer, forToolName toolName: String) {
		byToolName[toolName] = renderer
	}

	static func renderer(toolName: String, presentation: ToolPresentation?) -> any ToolStepRenderer {
		if let renderer = byToolName[toolName] {
			return renderer
		}
		if let kind = presentation?.kind, let renderer = byKind[kind] {
			return renderer
		}
		return GenericStepRenderer()
	}
}

/// Resolved, render-ready content for one tool step row.
struct ToolStepDisplay: Equatable {
	let title: String
	let systemImage: String
	let chips: [ToolArgChip]
	let liveItems: [ToolProgressItem]
	let fraction: Double?
	let summary: String
	let phase: ToolStepPhase

	@MainActor
	static func resolve(_ context: ToolStepContext) -> ToolStepDisplay {
		let renderer = ToolStepRendererRegistry.renderer(
			toolName: context.toolName,
			presentation: context.presentation,
		)
		let live = renderer.liveItems(context)
		return ToolStepDisplay(
			title: renderer.title(context),
			systemImage: renderer.systemImage(context),
			chips: renderer.chips(context),
			liveItems: live,
			fraction: live.isEmpty ? nil : context.progress?.fraction,
			summary: renderer.summary(context),
			phase: context.phase,
		)
	}
}
