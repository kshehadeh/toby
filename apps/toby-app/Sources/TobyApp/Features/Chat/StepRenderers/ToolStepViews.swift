import SwiftUI

// MARK: - WorkStep → renderer context

extension WorkStep {
	/// Tool steps go through the renderer registry; lifecycle/plan rows don't.
	var isRenderableToolStep: Bool {
		guard let toolName, !toolName.isEmpty else { return false }
		return type == .tool || type == .toolCall
	}

	/// Finished housekeeping step (tool listing, enabling tools) that the work
	/// log omits. Running or failed transient steps stay visible.
	var isHiddenTransientStep: Bool {
		guard isRenderableToolStep, !isActive, !failed else { return false }
		return ToolStepTransience.isTransient(toolName: toolName, presentation: presentation)
	}

	var toolPhase: ToolStepPhase {
		if failed { return .failed }
		if isActive { return .running }
		if cacheHit == true { return .cached }
		return .done
	}

	func toolContext() -> ToolStepContext? {
		guard isRenderableToolStep, let toolName else { return nil }
		return ToolStepContext(
			toolName: toolName,
			integrationLabel: integrationLabel,
			args: args ?? [:],
			presentation: presentation,
			progress: progress,
			phase: toolPhase,
			resultSummary: fullBody ?? body,
			fallbackTitle: title,
		)
	}

	/// Resolved display, merging argument chips across grouped (`×n`) calls.
	@MainActor
	func toolDisplay() -> ToolStepDisplay? {
		guard var context = toolContext() else { return nil }
		guard count > 1, !children.isEmpty else {
			return ToolStepDisplay.resolve(context)
		}
		if context.args.isEmpty, let firstArgs = children.first?.args {
			context = ToolStepContext(
				toolName: context.toolName,
				integrationLabel: context.integrationLabel,
				args: firstArgs,
				presentation: context.presentation,
				progress: context.progress,
				phase: context.phase,
				resultSummary: "",
				fallbackTitle: context.fallbackTitle,
			)
		}
		let base = ToolStepDisplay.resolve(context)
		var seen = Set<String>()
		let merged = children
			.compactMap { $0.toolDisplay() }
			.flatMap(\.chips)
			.filter { $0.id != "overflow" && seen.insert("\($0.key ?? "")\($0.text)").inserted }
		return ToolStepDisplay(
			title: base.title,
			systemImage: base.systemImage,
			chips: ToolArgChipBuilder.collapseOverflow(merged),
			liveItems: base.liveItems,
			fraction: base.fraction,
			summary: "",
			phase: base.phase,
		)
	}
}

// MARK: - Row

/// One tool call in the work log: glyph, title, argument chips, the transient
/// live rail while running, and the completion summary.
struct ToolStepRow: View {
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	let step: WorkStep
	let display: ToolStepDisplay
	var errorText: String? = nil
	/// The turn failed on this step even if the call itself returned.
	var isFailing = false

	@State private var showsRuns = false

	private var showsFailure: Bool { display.phase == .failed || isFailing }

	private var canShowRuns: Bool { step.count > 1 && step.children.count > 1 }

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			Image(systemName: showsFailure ? "exclamationmark.circle" : display.systemImage)
				.font(.system(size: 13, weight: .medium))
				.foregroundStyle(glyphColor)
				.frame(width: 16)
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 3) {
				header
				if !display.chips.isEmpty {
					ToolArgChipsView(chips: display.chips)
				}
				if !display.liveItems.isEmpty {
					ToolLiveRail(items: display.liveItems, fraction: display.fraction)
						.transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .top)))
				}
				if let errorText, !errorText.isEmpty {
					Text(errorText)
						.font(.system(size: 12))
						.foregroundStyle(palette.error)
						.lineLimit(2)
				}
				if showsRuns {
					ToolRunList(runs: step.children)
						.transition(reduceMotion ? .identity : .opacity)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(.vertical, 6)
		.padding(.horizontal, 12)
		.animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: display.liveItems.isEmpty)
		.animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: showsRuns)
		// Keep children separate when the row has its own disclosure button.
		.accessibilityElement(children: canShowRuns ? .contain : .combine)
		.accessibilityLabel(accessibilityText)
	}

	private var header: some View {
		HStack(alignment: .firstTextBaseline, spacing: 8) {
			Text(display.title)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(palette.primary)
				.lineLimit(1)
				.layoutPriority(1)
			// Result shares the title line so finished steps stay one row tall.
			if !display.summary.isEmpty {
				Text(display.summary)
					.font(isPath(display.summary) ? .system(size: 11.5, design: .monospaced) : .system(size: 12))
					.foregroundStyle(palette.faint)
					.lineLimit(1)
					.truncationMode(isPath(display.summary) ? .middle : .tail)
					.textSelection(.enabled)
			}
			Spacer(minLength: 0)
			meta
			if canShowRuns {
				Button {
					showsRuns.toggle()
				} label: {
					Image(systemName: showsRuns ? "chevron.down" : "chevron.right")
						.font(.system(size: 11, weight: .semibold))
						.foregroundStyle(palette.faint)
				}
				.buttonStyle(.plain)
				.accessibilityLabel(showsRuns ? "Hide individual calls" : "Show individual calls")
			}
		}
	}

	@ViewBuilder
	private var meta: some View {
		HStack(spacing: 6) {
			if display.phase == .running {
				ProgressView()
					.controlSize(.mini)
					.accessibilityLabel("Running")
			}
			if display.phase == .cached {
				Text("cached")
					.font(.system(size: 10.5))
					.foregroundStyle(Color(nsColor: .tobyMarkdownHeading))
					.padding(.vertical, 1)
					.padding(.horizontal, 6)
					.background(palette.chipFill, in: Capsule())
			}
			if step.count > 1 {
				Text("×\(step.count)")
					.font(.system(size: 12))
					.foregroundStyle(palette.faint)
					.monospacedDigit()
			}
			if display.phase != .running, let durationMs = step.durationMs, durationMs > 0 {
				Text(formatActivityDuration(TimeInterval(durationMs) / 1000))
					.font(.system(size: 12))
					.foregroundStyle(palette.faint)
					.monospacedDigit()
			}
		}
	}

	private var glyphColor: Color {
		showsFailure ? palette.failureGlyph : Color(nsColor: .tobyMarkdownHeading)
	}

	private var palette: ToolStepPalette { ToolStepPalette(colorScheme: colorScheme) }

	private func isPath(_ text: String) -> Bool {
		text.hasPrefix("/") || text.hasPrefix("~/") || text.hasPrefix("file://")
	}

	private var accessibilityText: String {
		var parts = [display.title]
		if !display.chips.isEmpty {
			parts.append(display.chips.map(\.text).joined(separator: ", "))
		}
		if display.phase == .running { parts.append("running") }
		if !display.summary.isEmpty { parts.append(display.summary) }
		return parts.joined(separator: ". ")
	}
}

// MARK: - Pieces

struct ToolStepPalette {
	let colorScheme: ColorScheme

	var primary: Color { colorScheme == .dark ? .white.opacity(0.88) : .black.opacity(0.88) }
	var secondary: Color { colorScheme == .dark ? .white.opacity(0.58) : .black.opacity(0.55) }
	var faint: Color { colorScheme == .dark ? .white.opacity(0.38) : .black.opacity(0.46) }
	var chipFill: Color { colorScheme == .dark ? .white.opacity(0.06) : .black.opacity(0.05) }
	var rail: Color { Color(nsColor: .tobyMarkdownHeading).opacity(0.25) }
	var success: Color { Color(red: 89 / 255, green: 191 / 255, blue: 115 / 255) }
	var failureGlyph: Color { Color(red: 194 / 255, green: 59 / 255, blue: 59 / 255) }
	var error: Color {
		colorScheme == .dark
			? Color(red: 242 / 255, green: 179 / 255, blue: 179 / 255)
			: Color(red: 158 / 255, green: 31 / 255, blue: 31 / 255)
	}
}

/// Capsules for the arguments the model supplied (queries, filters, paths).
struct ToolArgChipsView: View {
	@Environment(\.colorScheme) private var colorScheme
	let chips: [ToolArgChip]

	var body: some View {
		let palette = ToolStepPalette(colorScheme: colorScheme)
		ActivityChipLayout(spacing: 5) {
			ForEach(chips) { chip in
				HStack(spacing: 4) {
					if let systemImage = chip.systemImage {
						Image(systemName: systemImage)
							.font(.system(size: 9.5, weight: .medium))
							.foregroundStyle(palette.faint)
							.accessibilityHidden(true)
					}
					if let key = chip.key {
						Text(key)
							.foregroundStyle(palette.faint)
					}
					Text(chip.text)
						.foregroundStyle(chip.isLiteral ? palette.primary : palette.secondary)
						.lineLimit(1)
						.truncationMode(.middle)
				}
				.font(chip.isLiteral ? .system(size: 11.5, design: .monospaced) : .system(size: 11.5))
				.padding(.vertical, 2)
				.padding(.horizontal, 7)
				.frame(maxWidth: 320, alignment: .leading)
				.fixedSize(horizontal: true, vertical: false)
				.background(palette.chipFill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
			}
		}
	}
}

/// Transient sub-items reported by a running tool (`tool_call_progress`).
struct ToolLiveRail: View {
	@Environment(\.colorScheme) private var colorScheme
	let items: [ToolProgressItem]
	let fraction: Double?

	var body: some View {
		let palette = ToolStepPalette(colorScheme: colorScheme)
		VStack(alignment: .leading, spacing: 4) {
			if let fraction {
				ProgressView(value: fraction)
					.progressViewStyle(.linear)
					.controlSize(.mini)
					.tint(Color(nsColor: .tobyMarkdownHeading))
					.frame(maxWidth: 240)
			}
			ForEach(items) { item in
				ToolLiveItemRow(item: item, palette: palette)
			}
		}
		.padding(.leading, 10)
		.overlay(alignment: .leading) {
			Rectangle()
				.fill(palette.rail)
				.frame(width: 1.5)
		}
		.padding(.top, 2)
		.accessibilityElement(children: .contain)
		.accessibilityLabel("Progress")
	}
}

private struct ToolLiveItemRow: View {
	let item: ToolProgressItem
	let palette: ToolStepPalette

	var body: some View {
		HStack(spacing: 7) {
			stateGlyph
				.frame(width: 12, height: 12)
			Text(item.label)
				.font(.system(size: 12))
				.foregroundStyle(labelColor)
				.lineLimit(1)
				.truncationMode(.tail)
			Spacer(minLength: 8)
			if let detail = item.detail, !detail.isEmpty {
				Text(detail)
					.font(.system(size: 11.5))
					.foregroundStyle(palette.faint)
					.monospacedDigit()
					.lineLimit(1)
			}
		}
		.frame(minHeight: 18)
	}

	@ViewBuilder
	private var stateGlyph: some View {
		switch item.state {
		case .running:
			ProgressView()
				.controlSize(.mini)
				.scaleEffect(0.7)
				.accessibilityLabel("In progress")
		case .waiting:
			Circle()
				.fill(palette.faint)
				.frame(width: 5, height: 5)
				.accessibilityLabel("Waiting")
		case .done:
			Image(systemName: "checkmark")
				.font(.system(size: 9, weight: .bold))
				.foregroundStyle(palette.success)
				.accessibilityLabel("Done")
		case .failed:
			Image(systemName: "xmark")
				.font(.system(size: 9, weight: .bold))
				.foregroundStyle(palette.failureGlyph)
				.accessibilityLabel("Failed")
		}
	}

	private var labelColor: Color {
		switch item.state {
		case .running: palette.secondary
		case .waiting, .done: palette.faint
		case .failed: palette.error
		}
	}
}

/// Expanded `×n` group: each call keeps its own chips, summary, and duration.
private struct ToolRunList: View {
	@Environment(\.colorScheme) private var colorScheme
	let runs: [WorkStep]

	var body: some View {
		let palette = ToolStepPalette(colorScheme: colorScheme)
		VStack(alignment: .leading, spacing: 9) {
			ForEach(runs) { run in
				if let display = run.toolDisplay() {
					VStack(alignment: .leading, spacing: 3) {
						HStack(alignment: .firstTextBaseline, spacing: 8) {
							if display.chips.isEmpty {
								Text(display.title)
									.font(.system(size: 12, weight: .medium))
									.foregroundStyle(palette.secondary)
							} else {
								ToolArgChipsView(chips: display.chips)
							}
							Spacer(minLength: 0)
							if let durationMs = run.durationMs, durationMs > 0 {
								Text(formatActivityDuration(TimeInterval(durationMs) / 1000))
									.font(.system(size: 12))
									.foregroundStyle(palette.faint)
									.monospacedDigit()
							}
						}
						if !display.summary.isEmpty {
							Text(display.summary)
								.font(.system(size: 12))
								.foregroundStyle(display.phase == .failed ? palette.error : palette.faint)
								.lineLimit(1)
						}
					}
				}
			}
		}
		.padding(.top, 4)
	}
}
