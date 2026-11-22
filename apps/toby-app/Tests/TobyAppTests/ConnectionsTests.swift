import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

private func node(_ id: String, _ type: String = "person", degree: Int = 1) -> GraphSnapshotNode {
	GraphSnapshotNode(id: id, type: type, label: id.capitalized, detail: nil, degree: degree, updatedAt: "2026-11-22T10:00:00.000Z")
}

private func edge(_ src: String, _ dst: String, type: String = "related_to", weight: Double = 1) -> GraphSnapshotEdge {
	GraphSnapshotEdge(id: "\(src)-\(dst)", src: src, dst: dst, type: type, weight: weight, confidence: 1, origin: "deterministic", occurrences: 1, reason: nil)
}

private let sample = GraphSnapshotResponse(
	nodes: [node("dana", degree: 5), node("acme", "org", degree: 3), node("deck", "thread"), node("lone", "topic")],
	edges: [edge("dana", "acme", type: "works_at"), edge("dana", "deck", type: "shared_activity", weight: 0.4)],
	totals: GraphSnapshotTotals(nodes: 40, edges: 90),
	truncated: true
)

@Suite("ForceGraphLayout")
struct ForceGraphLayoutTests {
	@Test("Linked nodes end up closer than unlinked ones")
	func settles() {
		var layout = ForceGraphLayout()
		layout.load(nodes: sample.nodes, edges: sample.edges)
		for _ in 0..<400 { layout.tick() }
		#expect(layout.isSettled)
		func distance(_ a: String, _ b: String) -> CGFloat {
			let p = layout.positions[layout.index[a]!], q = layout.positions[layout.index[b]!]
			return hypot(p.x - q.x, p.y - q.y)
		}
		#expect(distance("dana", "acme") < distance("acme", "lone"))
		#expect(layout.positions.allSatisfy { $0.x.isFinite && $0.y.isFinite })
	}

	@Test("Reloading keeps positions of nodes that stay")
	func keepsPositions() {
		var layout = ForceGraphLayout()
		layout.load(nodes: sample.nodes, edges: sample.edges)
		for _ in 0..<50 { layout.tick() }
		let before = layout.positions[layout.index["dana"]!]
		layout.load(nodes: sample.nodes + [node("new")], edges: sample.edges + [edge("new", "dana")])
		#expect(layout.positions[layout.index["dana"]!] == before)
		#expect(layout.count == 5)
		#expect(!layout.isSettled)
	}

	@Test("Hit testing finds the node under a point")
	func hitTest() {
		var layout = ForceGraphLayout()
		layout.load(nodes: [node("a")], edges: [])
		let p = layout.positions[0]
		#expect(layout.node(at: p) == 0)
		#expect(layout.node(at: CGPoint(x: p.x + 200, y: p.y)) == nil)
	}

	@Test("Radius grows with degree and is capped")
	func radius() {
		#expect(ForceGraphLayout.radius(forDegree: 0) < ForceGraphLayout.radius(forDegree: 10))
		#expect(ForceGraphLayout.radius(forDegree: 100_000) == 20)
	}
}

@MainActor
@Suite("ConnectionsStore")
struct ConnectionsStoreTests {
	@Test("Applying a snapshot indexes connections and the summary")
	func apply() {
		let store = ConnectionsStore()
		store.apply(sample)
		let links = store.connections(of: "dana")
		#expect(links.map(\.node.id) == ["acme", "deck"])
		#expect(store.neighborIds(of: "deck") == ["dana"])
		#expect(store.kindCounts[.person] == 1)
		store.resetForHomeSwitch()
		#expect(store.snapshot.nodes.isEmpty)
	}

	@Test("Selection is cleared when the node leaves the snapshot")
	func dropsStaleSelection() {
		let store = ConnectionsStore()
		store.apply(sample)
		store.selectedNodeId = "lone"
		store.apply(GraphSnapshotResponse(nodes: [node("dana")], edges: [], totals: sample.totals, truncated: false))
		#expect(store.selectedNodeId == nil)
	}

	@Test("Search matches labels case-insensitively")
	func search() {
		let store = ConnectionsStore()
		store.apply(sample)
		store.searchQuery = "  ACM "
		#expect(store.searchMatches == ["acme"])
	}

	@Test("Screen and world coordinates round-trip and zoom keeps the anchor fixed")
	func camera() {
		let store = ConnectionsStore()
		let size = CGSize(width: 800, height: 600)
		store.offset = CGSize(width: 30, height: -20)
		store.scale = 1.5
		let world = CGPoint(x: 12, y: -40)
		let back = store.toWorld(store.toScreen(world, in: size), in: size)
		#expect(abs(back.x - world.x) < 0.001 && abs(back.y - world.y) < 0.001)
		let anchor = CGPoint(x: 100, y: 120)
		let before = store.toWorld(anchor, in: size)
		store.zoom(by: 2, anchor: anchor, in: size)
		let after = store.toWorld(anchor, in: size)
		#expect(abs(before.x - after.x) < 0.001 && abs(before.y - after.y) < 0.001)
		store.zoom(by: 1000, in: size)
		#expect(store.scale == ConnectionsStore.scaleRange.upperBound)
	}
}

@MainActor
@Suite("Connections views")
struct ConnectionsViewTests {
	@Test("Connections is a sidebar destination with its own tutorial")
	func route() {
		#expect(DetailRoute.sidebarPrimary.contains(.connections))
		#expect(DetailRoute.connections.menuTitle == "Connections")
		#expect(TutorialSection.forRoute(.connections) == .connections)
	}

	@Test("Inspector lists connections with direction-aware wording")
	func inspector() throws {
		let store = ConnectionsStore()
		store.apply(sample)
		let view = ConnectionsInspector(
			node: sample.nodes[0],
			connections: store.connections(of: "dana"),
			onSelect: { _ in },
			onClose: {}
		)
		let texts = try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }
		#expect(texts.contains("Dana"))
		#expect(texts.contains("Acme"))
		#expect(texts.contains("works at →"))
		#expect(texts.contains("1 shared item"))
	}

	@Test("Summary notes when only the strongest nodes are shown")
	func summary() {
		let store = ConnectionsStore()
		#expect(store.summaryLine.isEmpty)
		store.apply(sample)
		#expect(store.summaryLine == "4 nodes · 2 links · strongest of 40")
	}

	@Test("Long labels are shortened with an ellipsis")
	func shortLabel() {
		#expect(ConnectionsGraphCanvas.shortLabel("Short") == "Short")
		#expect(ConnectionsGraphCanvas.shortLabel(String(repeating: "x", count: 40)).count == 32)
	}
}
