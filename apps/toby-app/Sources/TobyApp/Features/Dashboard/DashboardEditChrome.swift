import SwiftUI

private struct DashboardEditingKey: EnvironmentKey {
	static let defaultValue = false
}

extension EnvironmentValues {
	/// True while the home dashboard is in layout-edit mode.
	var dashboardIsEditing: Bool {
		get { self[DashboardEditingKey.self] }
		set { self[DashboardEditingKey.self] = newValue }
	}
}

struct DashboardSlotFramesKey: PreferenceKey {
	static let defaultValue: [DashboardSlotFrame] = []

	static func reduce(value: inout [DashboardSlotFrame], nextValue: () -> [DashboardSlotFrame]) {
		value.append(contentsOf: nextValue())
	}
}

struct DashboardTrayFrameKey: PreferenceKey {
	static let defaultValue: CGRect = .null

	static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
		let next = nextValue()
		if next != .null {
			value = next
		}
	}
}

/// Hover outline with a drag handle and hide button (edit mode only).
struct DashboardEditOverlay: View {
	let title: String
	let blockID: DashboardBlockID
	var isHovered: Bool
	var isDragging: Bool
	let onHide: () -> Void
	let onDragChanged: (DragGesture.Value) -> Void
	let onDragEnded: () -> Void

	var body: some View {
		// Clear fill gives the overlay a real size in the card ZStack (a
		// stroke-only shape has no intrinsic size) and a hover/hit target.
		RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
			.fill(Color.clear)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.stroke(AppTheme.accent.opacity(outlineOpacity), lineWidth: 2)
			)
			.overlay(alignment: .topLeading) {
				handle
					.padding(8)
					.opacity(isDragging ? 0 : 1)
			}
			.overlay(alignment: .topTrailing) {
				hideButton
					.padding(8)
					.opacity(isDragging ? 0 : 1)
					.allowsHitTesting(!isDragging)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.contentShape(RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
			.highPriorityGesture(cardDragGesture)
	}

	private var cardDragGesture: some Gesture {
		DragGesture(minimumDistance: 4, coordinateSpace: .named(DashboardEditSpace.name))
			.onChanged(onDragChanged)
			.onEnded { _ in onDragEnded() }
	}

	/// Strong outline on the hovered card; quieter chrome on the rest so edit
	/// mode is obvious without waiting for hover.
	private var outlineOpacity: Double {
		if isDragging { return 0 }
		return isHovered ? 1 : 0.45
	}

	private var handle: some View {
		Image(systemName: "line.3.horizontal")
			.font(.system(size: 13, weight: .semibold))
			.foregroundStyle(AppTheme.primaryText)
			.frame(width: 28, height: 28)
			.background(
				RoundedRectangle(cornerRadius: 8)
					.fill(AppTheme.elevatedBackground)
			)
			.contentShape(Rectangle())
			.help("Drag to reorder")
			.accessibilityLabel("Reorder \(title)")
			.accessibilityIdentifier("dashboard-reorder-\(blockID.rawValue)")
	}

	private var hideButton: some View {
		Button(action: onHide) {
			Image(systemName: "eye.slash")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.frame(width: 28, height: 28)
				.background(
					RoundedRectangle(cornerRadius: 8)
						.fill(AppTheme.elevatedBackground)
				)
		}
		.buttonStyle(.plain)
		.help("Hide this card")
		.accessibilityLabel("Hide \(title)")
		.accessibilityIdentifier("dashboard-hide-\(blockID.rawValue)")
	}
}

/// Lifted clone that follows the pointer during a layout drag.
struct DashboardDragPreview: View {
	let title: String
	let systemImage: String
	var isChip: Bool = false

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: systemImage)
				.font(.system(size: isChip ? 12 : 16, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
			Text(title)
				.font(.system(size: isChip ? 12 : 14, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
		}
		.padding(.horizontal, isChip ? 10 : 16)
		.padding(.vertical, isChip ? 8 : 14)
		.background(
			RoundedRectangle(cornerRadius: isChip ? 8 : AppTheme.cornerRadius)
				.fill(AppTheme.panelBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: isChip ? 8 : AppTheme.cornerRadius)
				.stroke(AppTheme.accent.opacity(0.7), lineWidth: 1)
		)
		.shadow(color: Color.black.opacity(0.2), radius: 10, y: 4)
		.scaleEffect(1.03)
		.allowsHitTesting(false)
		.accessibilityHidden(true)
	}
}

extension View {
	func dashboardSlotFrame(id: DashboardBlockID) -> some View {
		background(
			GeometryReader { geo in
				Color.clear.preference(
					key: DashboardSlotFramesKey.self,
					value: [
						DashboardSlotFrame(
							id: id,
							frame: geo.frame(in: .named(DashboardEditSpace.name))
						),
					]
				)
			}
		)
	}
}
