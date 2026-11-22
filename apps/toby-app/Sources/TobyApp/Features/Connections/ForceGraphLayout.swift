import CoreGraphics
import Foundation

/// Small force-directed layout (link springs, many-body repulsion, centering)
/// in world coordinates centered on the origin. Pure value type so it can be
/// stepped deterministically in tests.
struct ForceGraphLayout {
	struct Link: Equatable {
		let source: Int
		let target: Int
		let weight: Double
	}

	private(set) var ids: [String] = []
	private(set) var index: [String: Int] = [:]
	private(set) var positions: [CGPoint] = []
	private(set) var radii: [CGFloat] = []
	private(set) var links: [Link] = []
	private var velocities: [CGVector] = []
	private var pinned: [Bool] = []

	/// Simulation "temperature"; forces scale with it and it decays each tick.
	private(set) var alpha: Double = 1

	static let minAlpha = 0.002
	private static let alphaDecay = 0.0228
	private static let velocityDecay: CGFloat = 0.55
	private static let chargeStrength: CGFloat = -180
	private static let maxChargeDistanceSquared: CGFloat = 520 * 520
	private static let centerStrength: CGFloat = 0.012

	var isSettled: Bool { alpha < Self.minAlpha }
	var count: Int { ids.count }

	/// Node radius from its graph-wide degree.
	static func radius(forDegree degree: Int) -> CGFloat {
		min(20, 5 + 2.6 * CGFloat(log2(Double(1 + max(0, degree)))))
	}

	/// Replace nodes and links, keeping positions of nodes that stay so a
	/// refresh or filter change does not scramble the picture.
	mutating func load(nodes: [GraphSnapshotNode], edges: [GraphSnapshotEdge]) {
		let previous = Dictionary(uniqueKeysWithValues: zip(ids, positions))
		ids = nodes.map(\.id)
		let lookup = Dictionary(ids.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
		index = lookup
		radii = nodes.map { Self.radius(forDegree: $0.degree) }
		links = edges.compactMap { edge in
			guard let s = lookup[edge.src], let t = lookup[edge.dst], s != t else { return nil }
			return Link(source: s, target: t, weight: edge.weight)
		}
		var neighbor: [Int: Int] = [:]
		for link in links {
			if neighbor[link.source] == nil { neighbor[link.source] = link.target }
			if neighbor[link.target] == nil { neighbor[link.target] = link.source }
		}
		var placed = ids.map { previous[$0] }
		let isNew = placed.map { $0 == nil }
		for i in ids.indices where placed[i] == nil {
			if let n = neighbor[i], let anchor = placed[n] {
				let angle = Double(i) * 2.399963
				placed[i] = CGPoint(x: anchor.x + 24 * cos(angle), y: anchor.y + 24 * sin(angle))
			}
		}
		for i in ids.indices where placed[i] == nil {
			// Phyllotaxis spiral gives an even, deterministic starting spread.
			let r = 14 * sqrt(Double(i) + 0.5)
			let angle = Double(i) * 2.399963
			placed[i] = CGPoint(x: r * cos(angle), y: r * sin(angle))
		}
		positions = placed.map { $0 ?? .zero }
		velocities = Array(repeating: .zero, count: ids.count)
		pinned = Array(repeating: false, count: ids.count)
		let addedShare = ids.isEmpty ? 0 : Double(isNew.filter { $0 }.count) / Double(ids.count)
		reheat(to: previous.isEmpty ? 1 : max(0.3, addedShare))
	}

	mutating func reheat(to value: Double = 0.3) {
		alpha = max(alpha, min(1, value))
	}

	mutating func tick() {
		guard !isSettled, !ids.isEmpty else { return }
		let a = CGFloat(alpha)
		let n = ids.count

		for link in links {
			let p = positions[link.source], q = positions[link.target]
			var dx = q.x - p.x, dy = q.y - p.y
			if dx == 0, dy == 0 { dx = 0.01; dy = 0.01 }
			let dist = sqrt(dx * dx + dy * dy)
			let rest = 46 + radii[link.source] + radii[link.target]
			let strength = 0.08 + 0.25 * CGFloat(link.weight)
			let k = (dist - rest) / dist * a * strength * 0.5
			velocities[link.source].dx += dx * k
			velocities[link.source].dy += dy * k
			velocities[link.target].dx -= dx * k
			velocities[link.target].dy -= dy * k
		}

		for i in 0..<n {
			let p = positions[i]
			for j in (i + 1)..<n {
				let q = positions[j]
				var dx = q.x - p.x, dy = q.y - p.y
				var d2 = dx * dx + dy * dy
				if d2 > Self.maxChargeDistanceSquared { continue }
				if d2 < 1 {
					dx = CGFloat(i - j) * 0.1 + 0.05
					dy = 0.05
					d2 = 1
				}
				let f = Self.chargeStrength * a / d2
				velocities[i].dx += dx * f
				velocities[i].dy += dy * f
				velocities[j].dx -= dx * f
				velocities[j].dy -= dy * f
			}
		}

		for i in 0..<n {
			if pinned[i] {
				velocities[i] = .zero
				continue
			}
			velocities[i].dx -= positions[i].x * Self.centerStrength * a
			velocities[i].dy -= positions[i].y * Self.centerStrength * a
			velocities[i].dx *= Self.velocityDecay
			velocities[i].dy *= Self.velocityDecay
			positions[i].x += velocities[i].dx
			positions[i].y += velocities[i].dy
		}
		alpha += (0 - alpha) * Self.alphaDecay
	}

	/// Move a node directly (drag) and hold it there until released.
	mutating func move(_ i: Int, to point: CGPoint) {
		guard positions.indices.contains(i) else { return }
		positions[i] = point
		pinned[i] = true
		reheat(to: 0.12)
	}

	mutating func release(_ i: Int) {
		guard pinned.indices.contains(i) else { return }
		pinned[i] = false
	}

	/// Topmost node whose circle (plus `slop`) contains `point`.
	func node(at point: CGPoint, slop: CGFloat = 3) -> Int? {
		var best: (Int, CGFloat)?
		for i in positions.indices {
			let dx = positions[i].x - point.x, dy = positions[i].y - point.y
			let d2 = dx * dx + dy * dy
			let r = radii[i] + slop
			if d2 <= r * r, best == nil || d2 < best!.1 { best = (i, d2) }
		}
		return best?.0
	}

	/// World-space box around every node, padded by its radius.
	var bounds: CGRect {
		guard !positions.isEmpty else { return .zero }
		var minX = CGFloat.infinity, minY = CGFloat.infinity
		var maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
		for (p, r) in zip(positions, radii) {
			minX = min(minX, p.x - r); maxX = max(maxX, p.x + r)
			minY = min(minY, p.y - r); maxY = max(maxY, p.y + r)
		}
		return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
	}
}
