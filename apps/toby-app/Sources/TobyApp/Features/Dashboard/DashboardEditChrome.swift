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

/// Reordering controls and insertion feedback shown in dashboard edit mode.
struct DashboardEditOverlay: View {
	enum DropEdge: Equatable {
		case before
		case after
	}

	let title: String
	let blockID: DashboardBlockID
	var isDragging: Bool = false
	/// Relative insertion target while a card drag is over this slot.
	var dropEdge: DropEdge? = nil
	/// Compact chrome for Actions rail rows (smaller radius and controls).
	var compact: Bool = false
	/// Visual reorder affordance. Off for the Actions rail (not reorderable).
	var showsHandle: Bool = true
	var onHide: (() -> Void)? = nil
	var onMoveEarlier: (() -> Void)? = nil
	var onMoveLater: (() -> Void)? = nil

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
			.overlay(alignment: dropEdge == .after ? .bottom : .top) {
				if dropEdge != nil {
					Capsule()
						.fill(AppTheme.accent)
						.frame(height: 4)
						.padding(.horizontal, 10)
						.offset(y: dropEdge == .after ? 10 : -10)
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
				if !isDragging, onHide != nil {
					hideButton
						.padding(controlPadding)
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.contentShape(RoundedRectangle(cornerRadius: cornerRadius))
			.accessibilityActions {
				if let onMoveEarlier {
					Button("Move earlier", action: onMoveEarlier)
				}
				if let onMoveLater {
					Button("Move later", action: onMoveLater)
				}
			}
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
		Button {
			onHide?()
		} label: {
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

/// Hit-tests a drag-session point against card frames and resolves the nearer
/// before/after edge of the targeted card.
enum DashboardDropGeometry {
	static func placement(
		at point: CGPoint,
		frames: [DashboardBlockID: CGRect],
		draggingID: DashboardBlockID?
	) -> DashboardLayout.CardPlacement? {
		let slots = frames.filter { $0.key != draggingID && !$0.value.isNull && $0.value.width > 1 }
		if let hit = slots.first(where: { $0.value.contains(point) }) {
			return placement(for: point, id: hit.key, frame: hit.value)
		}
		let padded = slots.filter { $0.value.insetBy(dx: -16, dy: -16).contains(point) }
		guard let nearest = padded.min(by: { lhs, rhs in
			distance(point, lhs.value) < distance(point, rhs.value)
		}) else { return nil }
		return placement(for: point, id: nearest.key, frame: nearest.value)
	}

	private static func placement(
		for point: CGPoint,
		id: DashboardBlockID,
		frame: CGRect
	) -> DashboardLayout.CardPlacement {
		point.y < frame.midY ? .before(id) : .after(id)
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
