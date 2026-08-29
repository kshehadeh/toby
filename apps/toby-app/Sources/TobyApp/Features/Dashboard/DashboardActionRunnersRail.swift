import SwiftUI

/// Compact list of runner-variant flows, hosted in the dashboard inspector.
///
/// Keep min/max sizes stable: no GeometryReader or preference writes. Updating
/// constraints while the system split divider is tracked crashes AppKit.
struct DashboardActionRunnersRail<Row: View>: View {
	let blocks: [CategoryDashboardBlock]
	@ViewBuilder var row: (CategoryDashboardBlock) -> Row

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Actions")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 2)
			VStack(alignment: .leading, spacing: 2) {
				ForEach(blocks, id: \.id) { block in
					row(block)
				}
			}
		}
		.frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("dashboard-actions-rail")
	}
}

/// One runner flow as a title button. Hover shows a system popover (can overflow the window).
struct DashboardActionRunnerRow: View {
	@Bindable var block: CategoryDashboardBlock
	var actionContext: DashboardBlockActionContext = .init()

	@Environment(\.dashboardIsEditing) private var isEditing
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@State private var isRunning = false
	@State private var runError: String?
	@State private var isHovered = false
	@State private var isHelpVisible = false
	@State private var hoverWorkItem: DispatchWorkItem?
	@State private var pulse = false

	private var descriptionText: String {
		let trimmed = block.descriptor.flowDescription?
			.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return trimmed.isEmpty ? "Run this flow." : trimmed
	}

	private var fillOpacity: Double {
		if isRunning {
			if reduceMotion { return 0.10 }
			return pulse ? 0.18 : 0.08
		}
		return isHovered ? 0.08 : 0
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Button(action: run) {
				HStack(spacing: 8) {
					if isRunning {
						ProgressView()
							.controlSize(.small)
							.frame(width: 16, height: 16)
					} else {
						Image(systemName: block.systemImage)
							.font(.system(size: 14, weight: .semibold))
							.foregroundStyle(AppTheme.accent)
							.frame(width: 16, height: 16)
					}
					Text(block.title)
						.font(.system(size: 12, weight: .medium))
						.foregroundStyle(AppTheme.primaryText)
						.lineLimit(1)
						.frame(minWidth: 0)
					Spacer(minLength: 0)
				}
				.padding(.vertical, 8)
				.padding(.horizontal, 8)
				.contentShape(RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius))
				.background(
					RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
						.fill(AppTheme.accent.opacity(fillOpacity))
				)
			}
			.buttonStyle(.plain)
			.disabled(isRunning || isEditing)
			.onHover(perform: handleHover)
			.popover(isPresented: $isHelpVisible, arrowEdge: .leading) {
				SidebarActionHelpPopover(title: block.title, detail: descriptionText)
					.environment(AppearancePreferences.shared)
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
					.padding(.horizontal, 8)
					.fixedSize(horizontal: false, vertical: true)
					.accessibilityIdentifier("dashboard-flow-run-error-\(block.id.rawValue)")
			}
		}
		.environment(AppearancePreferences.shared)
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
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: workItem)
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
