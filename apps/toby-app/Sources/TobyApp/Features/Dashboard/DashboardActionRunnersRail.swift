import SwiftUI

/// Shortcuts-style tiles for runner-variant flows, hosted in the inspector.
///
/// Keep min/max sizes stable: no GeometryReader or preference writes. Updating
/// constraints while the system split divider is tracked crashes AppKit.
struct DashboardActionRunnersRail<Row: View>: View {
	let blocks: [CategoryDashboardBlock]
	@ViewBuilder var row: (CategoryDashboardBlock) -> Row

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Actions")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 2)
			DashboardActionIconGrid(
				minItemWidth: DashboardBlockLayout.actionTileWidth,
				spacing: DashboardBlockLayout.actionIconGridSpacing
			) {
				ForEach(blocks, id: \.id) { block in
					row(block)
				}
			}
			.padding(.horizontal, 8)
		}
		.frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("dashboard-actions-rail")
	}
}

/// Row-major wrap of Actions tiles. Uses the proposed width only.
struct DashboardActionIconGrid: Layout {
	var minItemWidth: CGFloat
	var spacing: CGFloat

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let width = resolvedWidth(proposal.width)
		guard !subviews.isEmpty else { return CGSize(width: width, height: 0) }
		let frames = frames(for: subviews, containerWidth: width)
		let height = frames.map(\.maxY).max() ?? 0
		return CGSize(width: width, height: height)
	}

	func placeSubviews(
		in bounds: CGRect,
		proposal: ProposedViewSize,
		subviews: Subviews,
		cache: inout ()
	) {
		let width = resolvedWidth(bounds.width)
		let frames = frames(for: subviews, containerWidth: width)
		for (subview, frame) in zip(subviews, frames) {
			subview.place(
				at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
				anchor: .topLeading,
				proposal: .init(width: frame.width, height: frame.height)
			)
		}
	}

	private func frames(for subviews: Subviews, containerWidth: CGFloat) -> [CGRect] {
		let columns = max(
			1,
			Int(floor((containerWidth + spacing) / (minItemWidth + spacing)))
		)
		let itemWidth = max(
			minItemWidth,
			(containerWidth - CGFloat(columns - 1) * spacing) / CGFloat(columns)
		)
		var column = 0
		var x: CGFloat = 0
		var y: CGFloat = 0
		var rowHeight: CGFloat = 0
		var result: [CGRect] = []
		result.reserveCapacity(subviews.count)
		for subview in subviews {
			if column == columns {
				x = 0
				y += rowHeight + spacing
				rowHeight = 0
				column = 0
			}
			let size = subview.sizeThatFits(.init(width: itemWidth, height: nil))
			result.append(CGRect(x: x, y: y, width: itemWidth, height: size.height))
			x += itemWidth + spacing
			column += 1
			rowHeight = max(rowHeight, size.height)
		}
		return result
	}

	private func resolvedWidth(_ width: CGFloat?) -> CGFloat {
		guard let width, width.isFinite, width > 0 else { return minItemWidth }
		return width
	}
}

/// One runner flow as a colored Shortcuts-style tile. Hover shows a system popover.
struct DashboardActionRunnerRow: View {
	@Bindable var block: CategoryDashboardBlock
	var actionContext: DashboardBlockActionContext = .init()
	var appearancePreferences: AppearancePreferences = .shared

	@Environment(\.dashboardIsEditing) private var isEditing
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@State private var isRunning = false
	@State private var runError: String?
	@State private var isHovered = false
	@State private var isHelpVisible = false
	@State private var hoverWorkItem: DispatchWorkItem?
	@State private var pulse = false

	static let helpHoverDelay: TimeInterval = 1.0

	private var descriptionText: String {
		let trimmed = block.descriptor.flowDescription?
			.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return trimmed.isEmpty ? "Run this flow." : trimmed
	}

	private var fillOpacity: Double {
		if isRunning {
			if reduceMotion { return 1 }
			return pulse ? 1 : 0.88
		}
		return 1
	}

	private var tileColor: Color {
		FlowColorOption.resolved(block.descriptor.flowColor).color
	}

	private var foreground: Color {
		Color.white.opacity(0.94)
	}

	var body: some View {
		VStack(spacing: 4) {
			Button(action: run) {
				tile
			}
			.buttonStyle(.plain)
			.disabled(isRunning || isEditing)
			.onHover(perform: handleHover)
			.popover(isPresented: $isHelpVisible, arrowEdge: .leading) {
				SidebarActionHelpPopover(title: block.title, detail: descriptionText)
					.environment(appearancePreferences)
			}
			.contextMenu {
				if !isEditing {
					Button("Open flow") {
						actionContext.openFlow(block.id.rawValue)
					}
				}
			}
			.accessibilityLabel(block.title)
			.accessibilityHint(descriptionText)
			.accessibilityIdentifier("dashboard-flow-run-\(block.id.rawValue)")

			if let runError {
				Text(runError)
					.font(.system(size: 10))
					.foregroundStyle(Color.red.opacity(0.9))
					.multilineTextAlignment(.center)
					.fixedSize(horizontal: false, vertical: true)
					.frame(maxWidth: .infinity)
					.accessibilityIdentifier("dashboard-flow-run-error-\(block.id.rawValue)")
			}
		}
		.frame(minWidth: DashboardBlockLayout.actionTileWidth, maxWidth: .infinity)
		.accessibilityIdentifier(block.accessibilityIdentifier)
		.onChange(of: isRunning) { _, running in
			updatePulse(running: running)
		}
		.onChange(of: isEditing) { _, editing in
			if editing {
				clearHelp()
			}
		}
	}

	private var tile: some View {
		let shape = RoundedRectangle(
			cornerRadius: DashboardBlockLayout.actionTileCornerRadius,
			style: .continuous
		)
		return ZStack(alignment: .topLeading) {
			shape.fill(tileColor.opacity(fillOpacity))
			if isHovered, !isRunning {
				shape.fill(Color.white.opacity(0.12))
			}
			VStack(alignment: .leading, spacing: 0) {
				HStack(alignment: .top, spacing: 6) {
					if isRunning {
						ProgressView()
							.controlSize(.mini)
							.tint(foreground)
					} else {
						Image(systemName: block.systemImage)
							.font(.system(size: 15, weight: .semibold))
							.foregroundStyle(foreground)
					}
					Spacer(minLength: 0)
					Image(systemName: "play.circle")
						.font(.system(size: 16, weight: .medium))
						.foregroundStyle(foreground.opacity(isRunning ? 0.55 : 0.92))
						.accessibilityHidden(true)
				}
				Spacer(minLength: 4)
				Text(block.title)
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(foreground)
					.lineLimit(2)
					.multilineTextAlignment(.leading)
					.frame(maxWidth: .infinity, alignment: .leading)
					.accessibilityHidden(true)
			}
			.padding(10)
		}
		.frame(maxWidth: .infinity)
		.frame(height: DashboardBlockLayout.actionTileHeight)
		.contentShape(shape)
		.clipShape(shape)
	}

	private func run() {
		guard !isRunning, !isEditing else { return }
		clearHelp()
		Task { @MainActor in
			isRunning = true
			runError = nil
			defer { isRunning = false }
			let response = await actionContext.runFlow(block.id.rawValue)
			if response == nil {
				runError = "Couldn’t run this flow."
			} else if let response, !response.ok {
				runError = response.error ?? "Flow failed"
			}
		}
	}

	private func handleHover(_ hovering: Bool) {
		isHovered = hovering
		hoverWorkItem?.cancel()
		guard !isEditing else {
			clearHelp()
			return
		}

		if hovering {
			let workItem = DispatchWorkItem {
				isHelpVisible = true
			}
			hoverWorkItem = workItem
			DispatchQueue.main.asyncAfter(deadline: .now() + Self.helpHoverDelay, execute: workItem)
		} else {
			clearHelp()
		}
	}

	private func clearHelp() {
		isHelpVisible = false
		hoverWorkItem = nil
	}

	private func updatePulse(running: Bool) {
		guard running, !reduceMotion else {
			pulse = false
			return
		}
		pulse = false
		withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
			pulse = true
		}
	}
}
