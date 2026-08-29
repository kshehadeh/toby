import SwiftUI

struct WorkedForRow: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.colorScheme) private var colorScheme

	let group: TranscriptWorkGroup
	let duration: TimeInterval?
	let activeWorkStartDate: Date?
	let isExpanded: Bool
	let onToggle: () -> Void
	var showsWorkDetails = true

	@State private var showsAllTools = false
	@State private var cachedSteps: [WorkStep] = []
	@State private var cachedStepsKey: WorkStepsCacheKey?

	private var stepsKey: WorkStepsCacheKey {
		WorkStepsCacheKey(group: group)
	}

	private var activitySteps: [WorkStep] {
		if cachedStepsKey == stepsKey {
			return cachedSteps
		}
		return workSteps(from: group)
	}

	var body: some View {
		Group {
			if group.isActive {
				TimelineView(.periodic(from: .now, by: 1.0)) { context in
					card(at: context.date)
				}
			} else {
				card(at: .now)
			}
		}
		.onAppear(perform: refreshStepsCache)
		.onChange(of: stepsKey) {
			refreshStepsCache()
		}
	}

	private func card(at date: Date) -> some View {
		let model = WorkActivityModel(
			group: group,
			steps: showsWorkDetails ? activitySteps : [],
			duration: liveDuration(at: date)
		)
		return HStack(alignment: .top, spacing: 0) {
			VStack(alignment: .leading, spacing: 0) {
				WorkActivityHeader(
					model: model,
					isExpanded: isExpanded,
					onToggle: onToggle
				)

				if isExpanded, showsWorkDetails {
					VStack(alignment: .leading, spacing: 0) {
						ForEach(model.steps) { step in
							ActivityStepRow(
								step: step,
								isFailing: model.isFailed && step.id == model.steps.last?.id,
								errorText: model.isFailed && step.id == model.steps.last?.id
									? model.errorText
									: nil
							)
							if step.id != model.steps.last?.id {
								ActivityHairline(opacity: 0.05)
							}
						}
						if model.steps.isEmpty, let errorText = model.errorText {
							Text(errorText)
								.font(.system(size: 12))
								.foregroundStyle(activityErrorColor)
								.lineLimit(2)
								.frame(maxWidth: .infinity, alignment: .leading)
								.padding(.vertical, 12)
								.padding(.horizontal, 14)
						}
						if !model.tools.isEmpty {
							ActivityHairline(opacity: 0.06)
							ActivityToolsFooter(
								tools: model.tools,
								showsAll: $showsAllTools
							)
						}
					}
					.transition(.opacity.combined(with: .move(edge: .top)))
				}
			}
			.frame(maxWidth: 640, alignment: .leading)
			.background(activityCardFill)
			.overlay {
				RoundedRectangle(cornerRadius: 12, style: .continuous)
					.stroke(activityBorderColor, lineWidth: 1)
			}
			.compositingGroup()
			.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
			Spacer(minLength: 0)
		}
		.animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: isExpanded)
	}

	private func liveDuration(at date: Date) -> TimeInterval? {
		if group.isActive, let started = activeWorkStartDate {
			return date.timeIntervalSince(started)
		}
		if let durationMs = group.durationMs {
			return TimeInterval(durationMs) / 1000.0
		}
		return duration
	}

	private func refreshStepsCache() {
		cachedSteps = showsWorkDetails ? workSteps(from: group) : []
		cachedStepsKey = stepsKey
	}

	private var activityCardFill: Color {
		colorScheme == .dark
			? Color(red: 28 / 255, green: 28 / 255, blue: 28 / 255)
			: .white
	}

	private var activityBorderColor: Color {
		colorScheme == .dark ? .white.opacity(0.08) : .black.opacity(0.10)
	}

	private var activityErrorColor: Color {
		colorScheme == .dark
			? Color(red: 242 / 255, green: 179 / 255, blue: 179 / 255)
			: Color(red: 158 / 255, green: 31 / 255, blue: 31 / 255)
	}
}

struct WorkActivityModel {
	let isRunning: Bool
	let errorText: String?
	let steps: [WorkStep]
	let tools: [String]
	let toolCount: Int
	let stepCount: Int
	let currentStep: Int?
	let totalSteps: Int?
	let duration: TimeInterval

	var isFailed: Bool { errorText != nil }

	var title: String {
		if isRunning { return "Working…" }
		if isFailed { return "Stopped after \(formatActivityDuration(duration))" }
		return "Worked for \(formatActivityDuration(duration))"
	}

	var summary: String {
		if isRunning {
			var parts = [formatActivityDuration(duration)]
			if let currentStep, let totalSteps {
				parts.append("step \(currentStep) of \(totalSteps)")
			}
			return parts.joined(separator: " · ")
		}
		if isFailed {
			let completed = currentStep ?? stepCount
			let total = totalSteps ?? stepCount
			var parts: [String] = []
			if total > 0 {
				parts.append("\(completed) of \(total) steps")
			}
			parts.append("1 error")
			return parts.joined(separator: " · ")
		}
		var parts: [String] = []
		if stepCount > 0 {
			parts.append("\(stepCount) \(stepCount == 1 ? "step" : "steps")")
		}
		if toolCount > 0 {
			parts.append("\(toolCount) tools")
		}
		return parts.joined(separator: " · ")
	}

	init(group: TranscriptWorkGroup, steps: [WorkStep], duration: TimeInterval?) {
		isRunning = group.isActive
		errorText = group.errorText
		self.steps = steps.filter { $0.type != .assistantInterim }
		stepCount = self.steps.count
		self.duration = max(duration ?? workStepDuration(from: steps) ?? 0.1, 0.1)

		if let selection = group.toolSelection {
			tools = selection.names
			toolCount = selection.count
		} else {
			var seen = Set<String>()
			tools = self.steps.compactMap(\.toolName).filter { seen.insert($0).inserted }
			toolCount = tools.count
		}

		let progress = Self.planProgress(in: self.steps)
		if let progress {
			currentStep = progress.current
			totalSteps = progress.total
		} else if group.isActive, !self.steps.isEmpty {
			currentStep = self.steps.firstIndex(where: \.isActive).map { $0 + 1 }
				?? self.steps.count
			totalSteps = self.steps.count
		} else {
			currentStep = nil
			totalSteps = nil
		}
	}

	private static func planProgress(in steps: [WorkStep]) -> (current: Int, total: Int)? {
		let pattern = #"(?i)(?:step|phase)?\s*(\d+)\s*(?:/|of)\s*(\d+)"#
		for step in steps.reversed() {
			let value = "\(step.title) \(step.body)"
			guard let match = value.range(of: pattern, options: .regularExpression) else {
				continue
			}
			let matched = String(value[match])
			let numbers = matched.split { !$0.isNumber }.compactMap { Int($0) }
			if numbers.count >= 2, numbers[0] > 0, numbers[1] >= numbers[0] {
				return (numbers[0], numbers[1])
			}
		}
		return nil
	}
}

private struct WorkActivityHeader: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.colorScheme) private var colorScheme

	let model: WorkActivityModel
	let isExpanded: Bool
	let onToggle: () -> Void

	var body: some View {
		VStack(spacing: 0) {
			Button(action: onToggle) {
				HStack(spacing: 8) {
					ActivityStatusIndicator(
						isRunning: model.isRunning,
						isFailed: model.isFailed
					)
					Text(model.title)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(primaryColor)
						.lineLimit(1)
						.monospacedDigit()
						.layoutPriority(2)
					if !model.summary.isEmpty {
						Text(model.summary)
							.font(.system(size: 13))
							.foregroundStyle(faintColor)
							.lineLimit(1)
							.truncationMode(.tail)
							.monospacedDigit()
							.layoutPriority(0)
					}
					Spacer(minLength: 0)
					Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
						.font(.system(size: 14, weight: .medium))
						.foregroundStyle(faintColor)
						.accessibilityHidden(true)
				}
				.padding(.vertical, 11)
				.padding(.horizontal, 14)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityLabel("\(model.title), \(model.summary)")
			.accessibilityHint(isExpanded ? "Collapse activity" : "Expand activity")

			if isExpanded {
				ActivityHairline(opacity: 0.08)
			}
		}
		.background(colorScheme == .dark ? Color.white.opacity(0.03) : Color.black.opacity(0.025))
		.animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: isExpanded)
	}

	private var primaryColor: Color {
		colorScheme == .dark ? .white.opacity(0.88) : .black.opacity(0.88)
	}

	private var faintColor: Color {
		// The nominal faint token is 38%; light mode is raised just enough to
		// keep small metadata above 3:1 on white.
		colorScheme == .dark ? .white.opacity(0.38) : .black.opacity(0.46)
	}
}

private struct ActivityStatusIndicator: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.colorScheme) private var colorScheme
	@State private var pulse = false

	let isRunning: Bool
	let isFailed: Bool

	var body: some View {
		Group {
			if isRunning {
				Circle()
					.fill(Color(red: 245 / 255, green: 158 / 255, blue: 31 / 255))
					.frame(width: 7, height: 7)
					.opacity(pulse ? 0.45 : 1)
					.scaleEffect(pulse ? 1.03 : 1)
			} else if isFailed {
				Image(systemName: "exclamationmark.circle")
					.foregroundStyle(Color(red: 194 / 255, green: 59 / 255, blue: 59 / 255))
			} else {
				Image(systemName: "clock")
					.foregroundStyle(
						colorScheme == .dark ? Color.white.opacity(0.38) : Color.black.opacity(0.46)
					)
			}
		}
		.font(.system(size: 14, weight: .medium))
		.frame(width: 16, height: 16)
		.accessibilityHidden(true)
		.animation(
			reduceMotion || !isRunning
				? nil
				: .easeInOut(duration: 0.85).repeatForever(autoreverses: true),
			value: pulse
		)
		.onAppear {
			pulse = isRunning && !reduceMotion
		}
		.onChange(of: isRunning) {
			pulse = isRunning && !reduceMotion
		}
		.onChange(of: reduceMotion) {
			pulse = isRunning && !reduceMotion
		}
	}
}

private struct ActivityStepRow: View {
	@Environment(\.colorScheme) private var colorScheme

	let step: WorkStep
	let isFailing: Bool
	let errorText: String?

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			Image(systemName: iconName)
				.font(.system(size: 15, weight: .medium))
				.foregroundStyle(isFailing ? failureGlyphColor : accentColor)
				.frame(width: 16)
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 3) {
				HStack(alignment: .firstTextBaseline, spacing: 8) {
					Text(step.title)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(primaryColor)
						.lineLimit(1)
					Spacer(minLength: 0)
					if step.count > 1 {
						Text("×\(step.count)")
							.font(.system(size: 12))
							.foregroundStyle(faintColor)
							.monospacedDigit()
					} else if let durationMs = step.durationMs {
						Text(formatActivityDuration(TimeInterval(durationMs) / 1000))
							.font(.system(size: 12))
							.foregroundStyle(faintColor)
							.monospacedDigit()
					}
				}
				if !detail.isEmpty {
					Text(detail)
						.font(isPath ? .system(size: 11.5, design: .monospaced) : .system(size: 12))
						.foregroundStyle(faintColor)
						.lineLimit(1)
						.truncationMode(isPath ? .middle : .tail)
				}
				if let errorText, !errorText.isEmpty {
					Text(errorText)
						.font(.system(size: 12))
						.foregroundStyle(errorColor)
						.lineLimit(2)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(.vertical, 12)
		.padding(.horizontal, 14)
	}

	private var detail: String {
		(step.fullBody ?? step.body).trimmingCharacters(in: .whitespacesAndNewlines)
	}

	private var isPath: Bool {
		detail.hasPrefix("/") || detail.hasPrefix("~/") || detail.hasPrefix("file://")
	}

	private var iconName: String {
		if isFailing { return "exclamationmark.circle" }
		if let toolName = step.toolName { return ToolDisplayLabels.iconForTool(toolName) }
		switch step.type {
		case .plan: return "list.bullet"
		case .toolOutput: return "doc.on.clipboard"
		case .assistantInterim: return "text.bubble"
		default: return "doc.text"
		}
	}

	private var accentColor: Color {
		Color(nsColor: .tobyMarkdownHeading)
	}
	private var failureGlyphColor: Color {
		Color(red: 194 / 255, green: 59 / 255, blue: 59 / 255)
	}
	private var primaryColor: Color {
		colorScheme == .dark ? .white.opacity(0.88) : .black.opacity(0.88)
	}
	private var faintColor: Color {
		colorScheme == .dark ? .white.opacity(0.38) : .black.opacity(0.46)
	}
	private var errorColor: Color {
		colorScheme == .dark
			? Color(red: 242 / 255, green: 179 / 255, blue: 179 / 255)
			: Color(red: 158 / 255, green: 31 / 255, blue: 31 / 255)
	}
}

private struct ActivityToolsFooter: View {
	@Environment(\.colorScheme) private var colorScheme
	let tools: [String]
	@Binding var showsAll: Bool

	private var visibleTools: [String] {
		showsAll ? tools : Array(tools.prefix(2))
	}

	var body: some View {
		ActivityChipLayout(spacing: 6) {
			Text("Tools")
				.font(.system(size: 12))
				.foregroundStyle(faintColor)
			ForEach(visibleTools, id: \.self) { tool in
				Text(tool)
					.font(.system(size: 12))
					.foregroundStyle(primaryColor)
					.padding(.vertical, 3)
					.padding(.horizontal, 9)
					.background(chipFill, in: Capsule())
			}
			if !showsAll, tools.count > 2 {
				Button("+\(tools.count - 2) more") {
					showsAll = true
				}
				.buttonStyle(.plain)
				.font(.system(size: 12))
				.foregroundStyle(Color(nsColor: .tobyMarkdownHeading))
			}
		}
		.padding(.vertical, 10)
		.padding(.horizontal, 14)
	}

	private var primaryColor: Color {
		colorScheme == .dark ? .white.opacity(0.88) : .black.opacity(0.88)
	}
	private var faintColor: Color {
		colorScheme == .dark ? .white.opacity(0.38) : .black.opacity(0.46)
	}
	private var chipFill: Color {
		colorScheme == .dark ? .white.opacity(0.06) : .black.opacity(0.05)
	}
}

private struct ActivityChipLayout: Layout {
	let spacing: CGFloat

	func sizeThatFits(
		proposal: ProposedViewSize,
		subviews: Subviews,
		cache: inout ()
	) -> CGSize {
		layout(proposal: proposal, subviews: subviews).size
	}

	func placeSubviews(
		in bounds: CGRect,
		proposal: ProposedViewSize,
		subviews: Subviews,
		cache: inout ()
	) {
		let result = layout(
			proposal: ProposedViewSize(width: bounds.width, height: proposal.height),
			subviews: subviews
		)
		for (index, point) in result.points.enumerated() {
			subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
		}
	}

	private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
		let maxWidth = proposal.width ?? .infinity
		var points: [CGPoint] = []
		var x: CGFloat = 0
		var y: CGFloat = 0
		var rowHeight: CGFloat = 0
		var widestRow: CGFloat = 0
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			if x > 0, x + size.width > maxWidth {
				widestRow = max(widestRow, x - spacing)
				x = 0
				y += rowHeight + spacing
				rowHeight = 0
			}
			points.append(CGPoint(x: x, y: y))
			x += size.width + spacing
			rowHeight = max(rowHeight, size.height)
		}
		widestRow = max(widestRow, max(0, x - spacing))
		return (CGSize(width: min(maxWidth, widestRow), height: y + rowHeight), points)
	}
}

private struct ActivityHairline: View {
	@Environment(\.colorScheme) private var colorScheme
	let opacity: Double

	var body: some View {
		Rectangle()
			.fill(colorScheme == .dark ? Color.white.opacity(opacity) : Color.black.opacity(opacity))
			.frame(height: 1)
	}
}

func workedSummaryLabel(duration: TimeInterval?) -> String {
	"Worked for \(formatActivityDuration(duration ?? 0.1))"
}

func formatActivityDuration(_ interval: TimeInterval) -> String {
	if interval < 1 {
		let tenths = min(0.9, max(0.1, interval))
		return String(format: "%.1fs", tenths)
	}
	let totalSeconds = max(1, Int(interval.rounded()))
	let hours = totalSeconds / 3600
	let minutes = (totalSeconds % 3600) / 60
	let seconds = totalSeconds % 60
	if hours > 0 {
		return seconds > 0 ? "\(hours)h \(minutes)m \(seconds)s" : "\(hours)h \(minutes)m"
	}
	if minutes > 0 {
		return seconds > 0 ? "\(minutes)m \(seconds)s" : "\(minutes)m"
	}
	return "\(seconds)s"
}

func workStepDuration(from steps: [WorkStep]) -> TimeInterval? {
	let durationMs = steps.reduce(0) { total, step in
		if let durationMs = step.durationMs {
			return total + durationMs
		}
		let childDurationMs = step.children.compactMap(\.durationMs).reduce(0, +)
		return total + childDurationMs
	}
	return durationMs > 0 ? TimeInterval(durationMs) / 1000.0 : nil
}

/// Fingerprint for the activity-step cache.
/// Count-only keys miss in-place `tool_call_complete` updates (body/duration change,
/// entry count does not), which left a finished turn showing "Running…".
struct WorkStepsCacheKey: Equatable {
	let groupId: String
	let isActive: Bool
	let durationMs: Int?
	let entryCount: Int
	let stampHash: Int

	init(group: TranscriptWorkGroup) {
		groupId = group.id
		isActive = group.isActive
		durationMs = group.durationMs
		entryCount = group.entries.count
		var hash = 0
		for entry in group.entries {
			hash ^= entry.contentStamp
			if case .boxedStep(let payload) = entry {
				hash ^= payload.body.hashValue
				hash ^= (payload.cacheHit == true ? 1 : 0)
			}
		}
		stampHash = hash
	}
}
