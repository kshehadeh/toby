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
	let durationMs: Int?
	let isActive: Bool
	let cacheHit: Bool?
	let toolName: String?
}

func workSteps(from group: TranscriptWorkGroup) -> [WorkStep] {
	let entries = group.entries
	return entries.enumerated().compactMap { index, entry in
		switch entry {
		case .boxedStep(let payload):
			if payload.variant == "lifecycle", TranscriptGrouping.isHiddenLifecycleHeader(payload.header) {
				return nil
			}
			let isActive = group.isActive && index == entries.count - 1 && payload.durationMs == nil
			let title = payload.toolName ?? payload.header
			let stepType: WorkStepType
			switch payload.variant {
			case "tool": stepType = .tool
			case "lifecycle": stepType = .lifecycle
			case "assistant_interim": stepType = .assistantInterim
			case "plan": stepType = .plan
			default: stepType = .lifecycle
			}
			return WorkStep(
				id: "\(payload.id)-\(payload.seq)",
				type: stepType,
				title: title,
				body: payload.body,
				durationMs: payload.durationMs,
				isActive: isActive,
				cacheHit: payload.cacheHit,
				toolName: payload.toolName
			)
		case .toolCall(let blockKey, let title):
			let isActive = group.isActive && index == entries.count - 1
			return WorkStep(
				id: "tool-call-\(blockKey)",
				type: .toolCall,
				title: title,
				body: "",
				durationMs: nil,
				isActive: isActive,
				cacheHit: nil,
				toolName: nil
			)
		case .toolOutput(let blockKey, let detail):
			return WorkStep(
				id: "tool-output-\(blockKey)",
				type: .toolOutput,
				title: "Result",
				body: detail,
				durationMs: nil,
				isActive: false,
				cacheHit: nil,
				toolName: nil
			)
		case .meta(let text):
			return WorkStep(
				id: "meta-\(text.hashValue)",
				type: .meta,
				title: "Info",
				body: text,
				durationMs: nil,
				isActive: false,
				cacheHit: nil,
				toolName: nil
			)
		default:
			return nil
		}
	}
}

struct WorkStepRow: View {
	let step: WorkStep

	var body: some View {
		switch step.type {
		case .tool:
			ToolStepRow(step: step)
		case .lifecycle:
			LifecycleStepRow(step: step)
		case .assistantInterim:
			AssistantInterimStepRow(step: step)
		case .plan:
			PlanStepRow(step: step)
		case .meta:
			MetaStepRow(step: step)
		case .toolCall:
			ToolStepRow(step: step)
		case .toolOutput:
			ToolOutputStepRow(step: step)
		}
	}
}

// MARK: - Shared work step components

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
			} else if let iconName {
				Image(systemName: iconName)
					.font(.system(size: 10, weight: .medium))
					.foregroundStyle(AppTheme.accent)
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

// MARK: - Tool step row

struct ToolStepRow: View {
	let step: WorkStep

	private var icon: String? {
		guard let toolName = step.toolName else { return nil }
		return ToolDisplayLabels.iconForTool(toolName)
	}

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(isActive: step.isActive, cacheHit: step.cacheHit, iconName: icon)
			VStack(alignment: .leading, spacing: 2) {
				HStack(alignment: .top, spacing: 8) {
					Text(step.title)
						.font(AppTheme.transcriptCaptionFont.weight(.semibold))
						.tracking(AppTheme.transcriptTracking)
						.foregroundStyle(AppTheme.secondaryText)
					Spacer(minLength: 0)
					if let durationMs = step.durationMs, durationMs > 0 {
						Text(formatDurationMs(durationMs))
							.font(AppTheme.transcriptCaptionFont)
							.tracking(AppTheme.transcriptTracking)
							.foregroundStyle(AppTheme.tertiaryText)
							.monospacedDigit()
					}
				}
				if !step.body.isEmpty {
					Text(step.body)
						.font(AppTheme.transcriptCaptionFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(4)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}
}

// MARK: - Tool output step row

struct ToolOutputStepRow: View {
	let step: WorkStep

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(isActive: false, cacheHit: nil, iconName: nil)
			VStack(alignment: .leading, spacing: 2) {
				Text(step.title)
					.font(AppTheme.transcriptCaptionFont.weight(.semibold))
					.tracking(AppTheme.transcriptTracking)
					.foregroundStyle(AppTheme.secondaryText)
				if !step.body.isEmpty {
					Text(step.body)
						.font(AppTheme.transcriptCaptionFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(4)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}
}

// MARK: - Lifecycle step row

struct LifecycleStepRow: View {
	let step: WorkStep

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(isActive: step.isActive, cacheHit: step.cacheHit)
			VStack(alignment: .leading, spacing: 2) {
				Text(step.title)
					.font(AppTheme.transcriptCaptionFont.weight(.semibold))
					.tracking(AppTheme.transcriptTracking)
					.foregroundStyle(AppTheme.secondaryText)
				if !step.body.isEmpty {
					Text(step.body)
						.font(AppTheme.transcriptCaptionFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(4)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}
}

// MARK: - Assistant interim step row

struct AssistantInterimStepRow: View {
	let step: WorkStep

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(isActive: step.isActive, cacheHit: step.cacheHit)
			VStack(alignment: .leading, spacing: 2) {
				Text(step.title)
					.font(AppTheme.transcriptCaptionFont.weight(.semibold))
					.tracking(AppTheme.transcriptTracking)
					.foregroundStyle(AppTheme.secondaryText)
				if !step.body.isEmpty {
					MarkdownText(
						text: step.body,
						font: AppTheme.transcriptCaptionFont,
						foregroundStyle: AppTheme.tertiaryText,
					)
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}
}

// MARK: - Plan step row

struct PlanStepRow: View {
	let step: WorkStep

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(isActive: step.isActive, cacheHit: nil, iconName: "list.bullet")
			VStack(alignment: .leading, spacing: 2) {
				Text(step.title)
					.font(AppTheme.transcriptCaptionFont.weight(.semibold))
					.tracking(AppTheme.transcriptTracking)
					.foregroundStyle(AppTheme.secondaryText)
				if !step.body.isEmpty {
					Text(step.body)
						.font(AppTheme.transcriptCaptionFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(6)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}
}

// MARK: - Meta step row

struct MetaStepRow: View {
	let step: WorkStep

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			WorkStepStatusIndicator(isActive: false, cacheHit: nil, iconName: "info.circle")
			Text(step.body.isEmpty ? step.title : "\(step.title): \(step.body)")
				.font(AppTheme.transcriptCaptionFont)
				.tracking(AppTheme.transcriptTracking)
				.lineSpacing(AppTheme.transcriptLineSpacing)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(4)
				.frame(maxWidth: .infinity, alignment: .leading)
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
	}
}
