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

/// Hide button (and optional drag handle) shown in dashboard edit mode.
struct DashboardEditOverlay: View {
	let title: String
	let blockID: DashboardBlockID
	var isDragging: Bool = false
	/// Insert-before target while a card drag is over this slot.
	var isDropTarget: Bool = false
	/// Compact chrome for Actions rail rows (smaller radius and controls).
	var compact: Bool = false
	/// Visual reorder affordance. Off for the Actions rail (not reorderable).
	var showsHandle: Bool = true
	let onHide: () -> Void

	private var cornerRadius: CGFloat {
		compact ? AppTheme.smallCornerRadius : AppTheme.cornerRadius
	}

	private var controlPadding: CGFloat { compact ? 4 : 8 }

	var body: some View {
		RoundedRectangle(cornerRadius: cornerRadius)
			.fill(Color.clear)
			.overlay {
				if isDragging {
					RoundedRectangle(cornerRadius: cornerRadius)
						.stroke(
							style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])
						)
						.foregroundStyle(AppTheme.separator)
				}
			}
			.overlay(alignment: .leading) {
				if isDropTarget {
					Capsule()
						.fill(AppTheme.accent)
						.frame(width: 6)
						.padding(.vertical, 6)
						.offset(x: -9)
						.shadow(color: AppTheme.accent.opacity(0.45), radius: 3, y: 0)
						.accessibilityIdentifier("dashboard-drop-indicator-\(blockID.rawValue)")
				}
			}
			.overlay(alignment: .topLeading) {
				if showsHandle, !isDragging {
					handle
						.padding(controlPadding)
				}
			}
			.overlay(alignment: .topTrailing) {
				if !isDragging {
					hideButton
						.padding(controlPadding)
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.contentShape(RoundedRectangle(cornerRadius: cornerRadius))
	}

	private var controlSize: CGFloat { compact ? 22 : 28 }

	private var handle: some View {
		Image(systemName: "line.3.horizontal")
			.font(.system(size: compact ? 11 : 13, weight: .semibold))
			.foregroundStyle(AppTheme.primaryText)
			.frame(width: controlSize, height: controlSize)
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
				.font(.system(size: compact ? 11 : 12, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
				.frame(width: controlSize, height: controlSize)
				.background(
					RoundedRectangle(cornerRadius: 8)
						.fill(AppTheme.elevatedBackground)
				)
		}
		.buttonStyle(.plain)
		.help(compact ? "Hide this action" : "Hide this card")
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
		.accessibilityHidden(true)
	}
}

/// Hit-tests a drag-session point against card frames. Always “insert before”.
enum DashboardDropGeometry {
	static func insertBeforeID(
		at point: CGPoint,
		frames: [DashboardBlockID: CGRect],
		draggingID: DashboardBlockID?
	) -> DashboardBlockID? {
		let slots = frames.filter { $0.key != draggingID && !$0.value.isNull && $0.value.width > 1 }
		if let hit = slots.first(where: { $0.value.contains(point) }) {
			return hit.key
		}
		let padded = slots.filter { $0.value.insetBy(dx: -16, dy: -16).contains(point) }
		return padded.min { lhs, rhs in
			distance(point, lhs.value) < distance(point, rhs.value)
		}?.key
	}

	private static func distance(_ point: CGPoint, _ rect: CGRect) -> CGFloat {
		let dx = point.x - rect.midX
		let dy = point.y - rect.midY
		return dx * dx + dy * dy
	}
}

/// System lift preview for one home-grid card.
struct CardReorderModifier: ViewModifier {
	let id: DashboardBlockID
	let title: String
	let systemImage: String
	let enabled: Bool
	let onBegan: () -> Void

	func body(content: Content) -> some View {
		if enabled {
			content
				.draggable(id) {
					DashboardDragPreview(title: title, systemImage: systemImage)
						.onAppear(perform: onBegan)
				}
		} else {
			content
		}
	}
}
