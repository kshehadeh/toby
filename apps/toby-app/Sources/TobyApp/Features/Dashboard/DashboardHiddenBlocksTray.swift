import SwiftUI

/// Hidden-card tray shown at the bottom of the dashboard in edit mode.
struct DashboardHiddenBlocksTray: View {
	let blocks: [CategoryDashboardBlock]
	let onShow: (DashboardBlockID) -> Void
	var onDragBegan: (DashboardBlockID) -> Void = { _ in }

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
		.accessibilityIdentifier("dashboard-hidden-tray")
	}

	private func chip(for block: CategoryDashboardBlock) -> some View {
		HStack(spacing: 8) {
			if !block.descriptor.isFlowRunner {
				Image(systemName: "line.3.horizontal")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.frame(width: 16, height: 16)
					.contentShape(Rectangle())
					.accessibilityLabel("Reorder \(block.title)")
			}
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
		.contentShape(RoundedRectangle(cornerRadius: 8))
		.modifier(HiddenCardDragModifier(
			id: block.id,
			title: block.title,
			systemImage: block.systemImage,
			enabled: !block.descriptor.isFlowRunner,
			onBegan: { onDragBegan(block.id) }
		))
		.accessibilityIdentifier("dashboard-hidden-chip-\(block.id.rawValue)")
	}
}

/// Cards can be dragged onto the home grid; Actions chips stay put (Show only).
private struct HiddenCardDragModifier: ViewModifier {
	let id: DashboardBlockID
	let title: String
	let systemImage: String
	let enabled: Bool
	let onBegan: () -> Void

	func body(content: Content) -> some View {
		if enabled {
			content
				.draggable(id) {
					DashboardDragPreview(title: title, systemImage: systemImage, isChip: true)
						.onAppear(perform: onBegan)
				}
		} else {
			content
		}
	}
}
