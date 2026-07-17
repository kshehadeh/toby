import AppKit
import SwiftUI

enum WorkStepType: Equatable {
	case tool
	case lifecycle
	case assistantInterim
	case plan
	case meta
	case toolOutput
	case toolCall
}

struct WorkStep: Identifiable {
	let id: String
	let type: WorkStepType
	let title: String
	let body: String
	let fullBody: String?
	let durationMs: Int?
	let isActive: Bool
	let cacheHit: Bool?
	let toolName: String?
	let count: Int
	let children: [WorkStep]
}

// MARK: - WorkStep construction

func workSteps(from group: TranscriptWorkGroup) -> [WorkStep] {
	let raw = rawWorkSteps(from: group)
	return aggregateConsecutiveToolSteps(raw)
}

private func rawWorkSteps(from group: TranscriptWorkGroup) -> [WorkStep] {
	var result: [WorkStep] = []
	let entries = group.entries
	var index = 0
	while index < entries.count {
		let entry = entries[index]
		switch entry {
		case .boxedStep(let payload):
			if payload.variant == "lifecycle", TranscriptGrouping.isHiddenLifecycleHeader(payload.header) {
				index += 1
				continue
			}
			result.append(makeBoxedStepWorkStep(payload: payload, group: group, index: index))
		case .toolCall(let blockKey, let title, let toolName):
			var pairBody = ""
			var pairToolName = toolName
			if index + 1 < entries.count {
				if case .toolOutput(let outputBlockKey, let detail, let outputToolName) = entries[index + 1], outputBlockKey == blockKey {
					pairBody = detail
					pairToolName = toolName ?? outputToolName
					index += 1
				}
			}
			let isActive = group.isActive && index == entries.count - 1
			let displayTitle = friendlyToolTitle(title: title, toolName: pairToolName)
			result.append(WorkStep(
				id: "tool-call-\(blockKey)",
				type: .toolCall,
				title: displayTitle,
				body: pairBody,
				fullBody: nil,
				durationMs: nil,
				isActive: isActive,
				cacheHit: nil,
				toolName: pairToolName,
				count: 1,
				children: []
			))
		case .toolOutput:
			// Should have been consumed by a preceding toolCall.
			break
		case .meta(let text):
			result.append(WorkStep(
				id: "meta-\(text.hashValue)",
				type: .meta,
				title: "Info",
				body: text,
				fullBody: nil,
				durationMs: nil,
				isActive: false,
				cacheHit: nil,
				toolName: nil,
				count: 1,
				children: []
			))
		default:
			break
		}
		index += 1
	}
	return result
}

private func makeBoxedStepWorkStep(
	payload: BoxedStepPayload,
	group: TranscriptWorkGroup,
	index: Int
) -> WorkStep {
	let isActive = group.isActive && index == group.entries.count - 1 && payload.durationMs == nil
	let stepType: WorkStepType
	switch payload.variant {
	case "tool": stepType = .tool
	case "lifecycle", "prep", "thinking": stepType = .lifecycle
	case "assistant_interim": stepType = .assistantInterim
	case "plan": stepType = .plan
	default: stepType = .lifecycle
	}

	let title: String
	if payload.variant == "tool" {
		title = payload.header.isEmpty
			? (payload.toolName.map { ToolDisplayLabels.displayLabel($0) } ?? "")
			: payload.header
	} else {
		title = payload.header
	}

	let children: [WorkStep]
	let count: Int
	if payload.variant == "tool", let runs = payload.toolRuns, !runs.isEmpty {
		children = runs.map { run in
			WorkStep(
				id: "tool-run-\(run.blockKey)",
				type: .tool,
				title: run.header,
				body: run.body,
				fullBody: run.fullBody,
				durationMs: run.durationMs,
				isActive: false,
				cacheHit: run.cacheHit,
				toolName: payload.toolName,
				count: 1,
				children: []
			)
		}
		count = runs.count
	} else {
		children = []
		count = 1
	}

	return WorkStep(
		id: "\(payload.id)-\(payload.seq)",
		type: stepType,
		title: title,
		body: payload.body,
		fullBody: payload.fullBody,
		durationMs: payload.durationMs,
		isActive: isActive,
		cacheHit: payload.cacheHit,
		toolName: payload.toolName,
		count: count,
		children: children
	)
}

private func friendlyToolTitle(title: String, toolName: String?) -> String {
	if let toolName = toolName, !toolName.isEmpty {
		return ToolDisplayLabels.displayLabel(toolName)
	}
	if !title.contains(" ") && title.range(of: "([a-z0-9])([A-Z])", options: .regularExpression) != nil {
		return ToolDisplayLabels.displayLabel(title)
	}
	return title
}

private func aggregateConsecutiveToolSteps(_ steps: [WorkStep]) -> [WorkStep] {
	var result: [WorkStep] = []
	var buffer: [WorkStep] = []

	func flush() {
		guard !buffer.isEmpty else { return }
		if buffer.count == 1 {
			result.append(buffer[0])
		} else {
			let first = buffer[0]
			let children = buffer.map { childWorkStep(from: $0) }
			let totalDurationMs = buffer.compactMap { $0.durationMs }.reduce(0, +)
			let isActive = buffer.contains { $0.isActive }
			result.append(WorkStep(
				id: first.id,
				type: first.type,
				title: first.title,
				body: "",
				fullBody: nil,
				durationMs: totalDurationMs > 0 ? totalDurationMs : nil,
				isActive: isActive,
				cacheHit: nil,
				toolName: first.toolName,
				count: buffer.count,
				children: children
			))
		}
		buffer = []
	}

	for step in steps {
		let canAggregate = (step.type == .tool || step.type == .toolCall) && step.children.isEmpty
		if let last = buffer.last,
		   canAggregate,
		   last.type == step.type,
		   step.toolName != nil,
		   step.toolName == last.toolName {
			buffer.append(step)
		} else {
			flush()
			if canAggregate {
				buffer = [step]
			} else {
				result.append(step)
			}
		}
	}
	flush()
	return result
}

private func childWorkStep(from step: WorkStep) -> WorkStep {
	WorkStep(
		id: step.id,
		type: step.type,
		title: step.title,
		body: step.body,
		fullBody: step.fullBody,
		durationMs: step.durationMs,
		isActive: step.isActive,
		cacheHit: step.cacheHit,
		toolName: step.toolName,
		count: 1,
		children: []
	)
}

// MARK: - Row views

struct WorkStepRow: View {
	let step: WorkStep

	var body: some View {
		ExpandableWorkStepRow(step: step)
	}
}

struct ExpandableWorkStepRow: View {
	let step: WorkStep
	@State private var isExpanded = false

	private var isExpandable: Bool {
		!step.children.isEmpty || hasMoreBodyToShow(step)
	}

	private var icon: String? {
		guard let toolName = step.toolName else { return nil }
		return ToolDisplayLabels.iconForTool(toolName)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if isExpandable {
				Button {
					withAnimation(.easeOut(duration: 0.2)) {
						isExpanded.toggle()
					}
				} label: {
					WorkStepHeader(step: step, isExpanded: isExpanded, icon: icon)
				}
				.buttonStyle(.plain)
			} else {
				WorkStepHeader(step: step, isExpanded: isExpanded, icon: icon)
			}

			if isExpanded {
				WorkStepExpandedBody(step: step)
					.padding(.leading, 26)
					.padding(.bottom, 6)
					.transition(.opacity.combined(with: .move(edge: .top)))
			}
		}
	}
}

struct WorkStepHeader: View {
	let step: WorkStep
	let isExpanded: Bool
	let icon: String?

	private var isExpandable: Bool {
		!step.children.isEmpty || hasMoreBodyToShow(step)
	}

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(
				isActive: step.isActive,
				cacheHit: step.cacheHit,
				iconName: step.type == .plan ? "list.bullet" : icon
			)
			VStack(alignment: .leading, spacing: 2) {
				HStack(alignment: .top, spacing: 8) {
					Text(step.title)
						.font(AppTheme.transcriptCaptionFont.weight(.semibold))
						.foregroundStyle(AppTheme.secondaryText)
					Spacer(minLength: 0)
					if step.count > 1 {
						Text("×\(step.count)")
							.font(AppTheme.transcriptCaptionFont)
							.foregroundStyle(AppTheme.tertiaryText)
					}
					if let durationMs = step.durationMs, durationMs > 0 {
						Text(formatDurationMs(durationMs))
							.font(AppTheme.transcriptCaptionFont)
							.foregroundStyle(AppTheme.tertiaryText)
							.monospacedDigit()
					}
					if isExpandable {
						Image(systemName: "chevron.right")
							.font(AppTheme.transcriptCaptionFont.weight(.semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.rotationEffect(.degrees(isExpanded ? 90 : 0))
							.accessibilityLabel(isExpanded ? "Collapse" : "Expand")
					}
				}
				if !isExpanded && step.count == 1 && !step.body.isEmpty {
					Text(step.body)
						.font(AppTheme.transcriptCaptionFont)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(4)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
		.contentShape(Rectangle())
	}
}

struct WorkStepExpandedBody: View {
	let step: WorkStep

	var body: some View {
		if step.children.isEmpty {
			WorkStepBodyText(step: step)
		} else {
			VStack(alignment: .leading, spacing: 10) {
				ForEach(step.children) { child in
					VStack(alignment: .leading, spacing: 4) {
						if !child.title.isEmpty && child.title != step.title {
							Text(child.title)
								.font(AppTheme.transcriptCaptionFont.weight(.semibold))
								.foregroundStyle(AppTheme.secondaryText)
						}
						WorkStepBodyText(step: child)
					}
					.padding(.vertical, 4)
				}
			}
		}
	}
}

struct WorkStepBodyText: View {
	let step: WorkStep

	private var displayText: String {
		step.fullBody ?? step.body
	}

	var body: some View {
		if step.type == .assistantInterim {
			MarkdownText(
				text: displayText,
				font: AppTheme.transcriptCaptionFont,
				foregroundStyle: AppTheme.tertiaryText,
			)
			.frame(maxWidth: .infinity, alignment: .leading)
		} else {
			Text(displayText)
				.font(AppTheme.transcriptCaptionFont)
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(maxWidth: .infinity, alignment: .leading)
				.textSelection(.enabled)
		}
	}
}

// MARK: - Shared components

struct WorkStepStatusIndicator: View {
	let isActive: Bool
	let cacheHit: Bool?
	var iconName: String? = nil

	var body: some View {
		Group {
			if isActive {
				ProgressView()
					.controlSize(.small)
			} else if cacheHit == true {
				Image(systemName: "checkmark.circle.fill")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.accent)
					.accessibilityLabel("Cache hit")
			} else if let iconName {
				Image(systemName: iconName)
					.font(.system(size: 10, weight: .medium))
					.foregroundStyle(AppTheme.accent)
					.accessibilityLabel("Tool icon")
			} else {
				Circle()
					.fill(AppTheme.accent)
					.frame(width: 7, height: 7)
			}
		}
		.frame(width: 16, height: 16)
		.frame(maxHeight: .infinity, alignment: .center)
	}
}

func formatDurationMs(_ ms: Int) -> String {
	let seconds = Double(ms) / 1000.0
	if seconds < 0.1 {
		return "0.1s"
	}
	if seconds < 100 {
		return String(format: "%.1fs", seconds)
	}
	return String(format: "%.0fs", seconds)
}

func hasMoreBodyToShow(_ step: WorkStep) -> Bool {
	if let fullBody = step.fullBody, fullBody != step.body {
		return true
	}
	let body = step.body.trimmingCharacters(in: .whitespacesAndNewlines)
	guard !body.isEmpty else { return false }
	let lineCount = body.components(separatedBy: .newlines).count
	return lineCount > 4 || body.count > 220
}
