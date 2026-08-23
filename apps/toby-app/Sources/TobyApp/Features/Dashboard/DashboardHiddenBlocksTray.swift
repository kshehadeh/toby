import SwiftUI

/// Hidden-card tray shown at the bottom of the dashboard in edit mode.
struct DashboardHiddenBlocksTray: View {
	let blocks: [CategoryDashboardBlock]
	var draggingID: DashboardBlockID?
	let onShow: (DashboardBlockID) -> Void
	let onDragChanged: (DashboardBlockID, DragGesture.Value) -> Void
	let onDragEnded: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Hidden cards")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.secondaryText)
			HStack(alignment: .top, spacing: 8) {
				ForEach(blocks, id: \.id) { block in
					chip(for: block)
				}
				Spacer(minLength: 0)
			}
		}
		.padding(14)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(AppTheme.elevatedBackground.opacity(0.6))
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
		.background(
			GeometryReader { geo in
				Color.clear.preference(
					key: DashboardTrayFrameKey.self,
					value: geo.frame(in: .named(DashboardEditSpace.name))
				)
			}
		)
		.accessibilityIdentifier("dashboard-hidden-tray")
	}

	private func chip(for block: CategoryDashboardBlock) -> some View {
		let isDragging = draggingID == block.id
		return HStack(spacing: 8) {
			Image(systemName: "line.3.horizontal")
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 16, height: 16)
				.contentShape(Rectangle())
				.accessibilityLabel("Reorder \(block.title)")
			Image(systemName: block.systemImage)
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
			Text(block.title)
				.font(.system(size: 12, weight: .medium))
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
			Button("Show") {
				onShow(block.id)
			}
			.buttonStyle(.plain)
			.font(.system(size: 11, weight: .semibold))
			.foregroundStyle(AppTheme.accent)
			.accessibilityLabel("Show \(block.title)")
			.accessibilityIdentifier("dashboard-unhide-\(block.id.rawValue)")
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(AppTheme.panelBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: 8)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
		.opacity(isDragging ? 0.35 : 1)
		.contentShape(RoundedRectangle(cornerRadius: 8))
		.highPriorityGesture(
			DragGesture(minimumDistance: 4, coordinateSpace: .named(DashboardEditSpace.name))
				.onChanged { onDragChanged(block.id, $0) }
				.onEnded { _ in onDragEnded() }
		)
		.accessibilityIdentifier("dashboard-hidden-chip-\(block.id.rawValue)")
	}
}
