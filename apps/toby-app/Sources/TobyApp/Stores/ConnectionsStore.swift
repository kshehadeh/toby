import Foundation
import Observation
import SwiftUI

/// State for the Connections view: the context-graph snapshot, filters,
/// selection, and the running force layout and camera.
@Observable
@MainActor
final class ConnectionsStore {
	private(set) var snapshot: GraphSnapshotResponse = .empty
	private(set) var isLoading = false
	private(set) var hasLoadedOnce = false
	var errorMessage: String?

	/// Kinds requested from the daemon. Changing it reloads.
	private(set) var visibleKinds: Set<GraphNodeKind> = GraphNodeKind.defaultVisible
	/// Max nodes requested; the daemon keeps the best-connected ones.
	private(set) var nodeLimit: Int = 200
	static let nodeLimitOptions = [100, 200, 350, 500]

	var selectedNodeId: String?
	var hoveredNodeId: String?
	var searchQuery: String = ""
	/// Node the canvas should scroll to on its next update (needs the view size).
	var pendingCenterId: String?

	/// Force layout in world coordinates; ticked by `runSimulation`.
	private(set) var layout = ForceGraphLayout()
	/// Screen = viewCenter + offset + world * scale.
	var scale: CGFloat = 1
	var offset: CGSize = .zero
	static let scaleRange: ClosedRange<CGFloat> = 0.15...4

	private let client: TobyClient
	private var simulationTask: Task<Void, Never>?
	private var loadToken = UUID()
	private var nodesById: [String: GraphSnapshotNode] = [:]
	private var adjacency: [String: [GraphSnapshotEdge]] = [:]
	/// Fit to the view once after the first layout settles a little.
	private var pendingFit = true

	init(client: TobyClient = TobyClient()) {
		self.client = client
	}

	// MARK: Derived

	var selectedNode: GraphSnapshotNode? {
		selectedNodeId.flatMap { nodesById[$0] }
	}

	func node(id: String) -> GraphSnapshotNode? { nodesById[id] }

	/// Neighbors of `id` in the snapshot, strongest link first.
	func connections(of id: String) -> [GraphConnection] {
		(adjacency[id] ?? [])
			.compactMap { edge in
				let other = edge.src == id ? edge.dst : edge.src
				return nodesById[other].map { GraphConnection(edge: edge, node: $0) }
			}
			.sorted { ($0.edge.weight, $0.node.degree) > ($1.edge.weight, $1.node.degree) }
	}

	func neighborIds(of id: String) -> Set<String> {
		Set((adjacency[id] ?? []).map { $0.src == id ? $0.dst : $0.src })
	}

	/// Node ids whose label matches the search query (empty when not searching).
	var searchMatches: Set<String> {
		let needle = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !needle.isEmpty else { return [] }
		return Set(snapshot.nodes.filter { $0.label.localizedCaseInsensitiveContains(needle) }.map(\.id))
	}

	/// Counts per kind in the current snapshot, for the legend.
	var kindCounts: [GraphNodeKind: Int] {
		snapshot.nodes.reduce(into: [:]) { counts, node in
			if let kind = node.kind { counts[kind, default: 0] += 1 }
		}
	}

	var summaryLine: String {
		guard hasLoadedOnce else { return "" }
		let shown = snapshot.nodes.count
		let links = snapshot.edges.count
		let base = "\(shown) \(shown == 1 ? "node" : "nodes") · \(links) \(links == 1 ? "link" : "links")"
		return snapshot.truncated ? "\(base) · strongest of \(snapshot.totals.nodes)" : base
	}

	// MARK: Loading

	func ensureLoaded() async {
		guard !hasLoadedOnce, !isLoading else { return }
		await load()
	}

	func load() async {
		let token = UUID()
		loadToken = token
		isLoading = true
		defer { if loadToken == token { isLoading = false } }
		do {
			let result = try await client.fetchGraphSnapshot(kinds: visibleKinds, limit: nodeLimit)
			guard loadToken == token else { return }
			apply(result)
			errorMessage = nil
		} catch {
			guard loadToken == token else { return }
			errorMessage = error.localizedDescription
		}
		hasLoadedOnce = true
	}

	/// Install a snapshot (also used by tests and previews).
	func apply(_ result: GraphSnapshotResponse) {
		snapshot = result
		hasLoadedOnce = true
		nodesById = Dictionary(result.nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
		var adj: [String: [GraphSnapshotEdge]] = [:]
		for edge in result.edges {
			adj[edge.src, default: []].append(edge)
			adj[edge.dst, default: []].append(edge)
		}
		adjacency = adj
		if let selectedNodeId, nodesById[selectedNodeId] == nil { self.selectedNodeId = nil }
		if let hoveredNodeId, nodesById[hoveredNodeId] == nil { self.hoveredNodeId = nil }
		if layout.count == 0 { pendingFit = true }
		layout.load(nodes: result.nodes, edges: result.edges)
		runSimulation()
	}

	func toggleKind(_ kind: GraphNodeKind) {
		var next = visibleKinds
		if next.contains(kind) { next.remove(kind) } else { next.insert(kind) }
		guard !next.isEmpty else { return }
		visibleKinds = next
		Task { await load() }
	}

	func setNodeLimit(_ limit: Int) {
		guard limit != nodeLimit else { return }
		nodeLimit = limit
		Task { await load() }
	}

	func resetForHomeSwitch() {
		simulationTask?.cancel()
		simulationTask = nil
		loadToken = UUID()
		snapshot = .empty
		nodesById = [:]
		adjacency = [:]
		layout = ForceGraphLayout()
		isLoading = false
		hasLoadedOnce = false
		errorMessage = nil
		selectedNodeId = nil
		hoveredNodeId = nil
		searchQuery = ""
		pendingCenterId = nil
		visibleKinds = GraphNodeKind.defaultVisible
		scale = 1
		offset = .zero
		pendingFit = true
	}

	// MARK: Simulation

	private func runSimulation() {
		guard simulationTask == nil else { return }
		simulationTask = Task { [weak self] in
			while let self, !Task.isCancelled, !self.layout.isSettled {
				// A few ticks per frame settles large graphs faster.
				for _ in 0..<2 { self.layout.tick() }
				try? await Task.sleep(for: .milliseconds(16))
			}
			self?.simulationTask = nil
		}
	}

	func dragNode(_ id: String, toWorld point: CGPoint) {
		guard let i = layout.index[id] else { return }
		layout.move(i, to: point)
		runSimulation()
	}

	func endDrag(_ id: String) {
		guard let i = layout.index[id] else { return }
		layout.release(i)
		runSimulation()
	}

	// MARK: Camera

	func toWorld(_ point: CGPoint, in size: CGSize) -> CGPoint {
		CGPoint(
			x: (point.x - size.width / 2 - offset.width) / scale,
			y: (point.y - size.height / 2 - offset.height) / scale
		)
	}

	func toScreen(_ point: CGPoint, in size: CGSize) -> CGPoint {
		CGPoint(
			x: size.width / 2 + offset.width + point.x * scale,
			y: size.height / 2 + offset.height + point.y * scale
		)
	}

	func nodeId(atScreen point: CGPoint, in size: CGSize) -> String? {
		let world = toWorld(point, in: size)
		return layout.node(at: world, slop: 4 / scale).map { layout.ids[$0] }
	}

	/// Zoom by `factor` keeping the screen point `anchor` fixed.
	func zoom(by factor: CGFloat, anchor: CGPoint? = nil, in size: CGSize) {
		let next = min(Self.scaleRange.upperBound, max(Self.scaleRange.lowerBound, scale * factor))
		let anchor = anchor ?? CGPoint(x: size.width / 2, y: size.height / 2)
		let world = toWorld(anchor, in: size)
		scale = next
		offset = CGSize(
			width: anchor.x - size.width / 2 - world.x * next,
			height: anchor.y - size.height / 2 - world.y * next
		)
	}

	func fit(in size: CGSize, padding: CGFloat = 48) {
		let box = layout.bounds
		guard box.width > 0, box.height > 0, size.width > 0, size.height > 0 else { return }
		let sx = (size.width - padding * 2) / box.width
		let sy = (size.height - padding * 2) / box.height
		scale = min(1.6, max(Self.scaleRange.lowerBound, min(sx, sy)))
		offset = CGSize(width: -box.midX * scale, height: -box.midY * scale)
	}

	/// Called each frame by the canvas; fits once the first layout has spread out.
	func fitIfPending(in size: CGSize) {
		guard pendingFit, layout.count > 0, layout.alpha < 0.35 || layout.isSettled else { return }
		pendingFit = false
		fit(in: size)
	}

	func center(on id: String, in size: CGSize) {
		guard let i = layout.index[id] else { return }
		let p = layout.positions[i]
		offset = CGSize(width: -p.x * scale, height: -p.y * scale)
	}
}
