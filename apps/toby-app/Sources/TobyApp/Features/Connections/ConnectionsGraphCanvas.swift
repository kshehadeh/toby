import SwiftUI

/// Interactive drawing of the context graph: drag the background to pan,
/// drag a node to move it, pinch or use the zoom controls to zoom, click a
/// node to select it.
struct ConnectionsGraphCanvas: View {
	@Bindable var store: ConnectionsStore

	private enum DragMode {
		case node(String)
		case pan(CGSize)
	}

	@State private var dragMode: DragMode?
	@State private var magnifyBase: CGFloat?

	/// Nodes labelled even when nothing is focused.
	private static let alwaysLabelledCount = 14

	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			Canvas(rendersAsynchronously: false) { context, canvasSize in
				draw(in: &context, size: canvasSize)
			}
			.contentShape(Rectangle())
			.gesture(dragGesture(size: size))
			.simultaneousGesture(magnifyGesture(size: size))
			.onTapGesture(coordinateSpace: .local) { point in
				store.selectedNodeId = store.nodeId(atScreen: point, in: size)
			}
			.onContinuousHover(coordinateSpace: .local) { phase in
				switch phase {
				case .active(let point):
					let id = store.nodeId(atScreen: point, in: size)
					if id != store.hoveredNodeId { store.hoveredNodeId = id }
				case .ended:
					store.hoveredNodeId = nil
				}
			}
			.pointerStyle(store.hoveredNodeId == nil ? .default : .link)
			.onChange(of: store.layout.alpha) { store.fitIfPending(in: size) }
			.onAppear { store.fitIfPending(in: size) }
			.onChange(of: store.pendingCenterId) { _, id in
				guard let id else { return }
				store.center(on: id, in: size)
				store.pendingCenterId = nil
			}
			.overlay(alignment: .bottomTrailing) { zoomControls(size: size) }
		}
		.accessibilityElement(children: .ignore)
		.accessibilityLabel("Connections graph")
		.accessibilityValue(store.summaryLine)
		.accessibilityHint("Select a node to see its connections in the inspector.")
		.accessibilityIdentifier("connections-graph-canvas")
	}

	// MARK: Gestures

	private func dragGesture(size: CGSize) -> some Gesture {
		DragGesture(minimumDistance: 3, coordinateSpace: .local)
			.onChanged { value in
				if dragMode == nil {
					if let id = store.nodeId(atScreen: value.startLocation, in: size) {
						dragMode = .node(id)
						store.selectedNodeId = id
					} else {
						dragMode = .pan(store.offset)
					}
				}
				switch dragMode {
				case .node(let id):
					store.dragNode(id, toWorld: store.toWorld(value.location, in: size))
				case .pan(let start):
					store.offset = CGSize(
						width: start.width + value.translation.width,
						height: start.height + value.translation.height
					)
				case nil:
					break
				}
			}
			.onEnded { _ in
				if case .node(let id) = dragMode { store.endDrag(id) }
				dragMode = nil
			}
	}

	private func magnifyGesture(size: CGSize) -> some Gesture {
		MagnifyGesture()
			.onChanged { value in
				let base = magnifyBase ?? store.scale
				magnifyBase = base
				store.zoom(by: base * value.magnification / store.scale, anchor: value.startLocation, in: size)
			}
			.onEnded { _ in magnifyBase = nil }
	}

	private func zoomControls(size: CGSize) -> some View {
		HStack(spacing: 2) {
			Button("Zoom out", systemImage: "minus.magnifyingglass") { store.zoom(by: 1 / 1.25, in: size) }
				.accessibilityIdentifier("connections-zoom-out")
			Button("Fit to window", systemImage: "arrow.up.left.and.arrow.down.right") { store.fit(in: size) }
				.accessibilityIdentifier("connections-zoom-fit")
			Button("Zoom in", systemImage: "plus.magnifyingglass") { store.zoom(by: 1.25, in: size) }
				.accessibilityIdentifier("connections-zoom-in")
		}
		.labelStyle(.iconOnly)
		.buttonStyle(.borderless)
		.controlSize(.large)
		.padding(.horizontal, 10)
		.padding(.vertical, 6)
		.glassEffect(.regular.interactive(), in: Capsule())
		.padding(14)
	}

	// MARK: Drawing

	private func draw(in context: inout GraphicsContext, size: CGSize) {
		let layout = store.layout
		guard layout.count > 0 else { return }
		let focus = store.selectedNodeId ?? store.hoveredNodeId
		let neighbors = focus.map { store.neighborIds(of: $0) } ?? []
		let matches = store.searchMatches
		let isDimming = focus != nil || !matches.isEmpty
		let scale = store.scale

		func screen(_ i: Int) -> CGPoint { store.toScreen(layout.positions[i], in: size) }
		func isHighlighted(_ id: String) -> Bool {
			id == focus || neighbors.contains(id) || matches.contains(id)
		}

		// Edges: batch the quiet ones into two paths, draw focused ones on top.
		var solid = Path(), dashed = Path(), focused = Path()
		for edge in store.snapshot.edges {
			guard let s = layout.index[edge.src], let t = layout.index[edge.dst] else { continue }
			let a = screen(s), b = screen(t)
			if let focus, edge.src == focus || edge.dst == focus {
				focused.move(to: a); focused.addLine(to: b)
			} else if edge.origin == "derived" {
				dashed.move(to: a); dashed.addLine(to: b)
			} else {
				solid.move(to: a); solid.addLine(to: b)
			}
		}
		let edgeOpacity = isDimming ? 0.08 : 0.28
		let lineWidth = max(0.5, min(1.4, scale))
		context.stroke(solid, with: .color(AppTheme.secondaryText.opacity(edgeOpacity)), lineWidth: lineWidth)
		context.stroke(
			dashed,
			with: .color(AppTheme.secondaryText.opacity(edgeOpacity * 0.85)),
			style: StrokeStyle(lineWidth: lineWidth, dash: [3, 3])
		)
		context.stroke(focused, with: .color(AppTheme.accent.opacity(0.85)), lineWidth: lineWidth + 0.8)

		// Nodes.
		for node in store.snapshot.nodes {
			guard let li = layout.index[node.id] else { continue }
			let center = screen(li)
			let r = max(2.5, layout.radii[li] * scale)
			let rect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
			let color = node.kind?.color ?? .gray
			let lit = !isDimming || isHighlighted(node.id)
			context.fill(Path(ellipseIn: rect), with: .color(color.opacity(lit ? 0.95 : 0.22)))
			if node.id == store.selectedNodeId {
				context.stroke(Path(ellipseIn: rect.insetBy(dx: -3, dy: -3)), with: .color(AppTheme.primaryText), lineWidth: 2)
			} else if matches.contains(node.id) {
				context.stroke(Path(ellipseIn: rect.insetBy(dx: -2.5, dy: -2.5)), with: .color(AppTheme.accent), lineWidth: 2)
			} else if node.id == store.hoveredNodeId {
				context.stroke(Path(ellipseIn: rect.insetBy(dx: -2, dy: -2)), with: .color(color), lineWidth: 1.5)
			}
		}

		// Labels last so they sit above every circle.
		let prominent = Set(store.snapshot.nodes.prefix(Self.alwaysLabelledCount).map(\.id))
		for node in store.snapshot.nodes {
			guard let li = layout.index[node.id] else { continue }
			let r = layout.radii[li] * scale
			let wanted: Bool
			if isDimming {
				wanted = isHighlighted(node.id)
			} else {
				wanted = prominent.contains(node.id) || r >= 9 || scale >= 1.6
			}
			guard wanted else { continue }
			let emphasized = node.id == focus
			let label = Text(Self.shortLabel(node.label))
				.font(.system(size: emphasized ? 12 : 10.5, weight: emphasized ? .semibold : .regular))
				.foregroundStyle(emphasized ? AppTheme.primaryText : AppTheme.secondaryText)
			let center = screen(li)
			context.draw(label, at: CGPoint(x: center.x, y: center.y + max(2.5, r) + 3), anchor: .top)
		}
	}

	static func shortLabel(_ label: String, max: Int = 32) -> String {
		let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
		guard trimmed.count > max else { return trimmed }
		return String(trimmed.prefix(max - 1)) + "…"
	}
}
