import CoreGraphics
import Foundation

/// App-local home-dashboard layout: card order plus which cards are hidden.
///
/// Persisted in `UserDefaults` with other UI prefs (not daemon / `~/.toby` config).
/// An empty `order` means “use the default grouping” (built-ins, then
/// informational flows, then runners). Unknown ids are ignored; newly
/// registered cards that are not listed append as visible.
struct DashboardLayout: Equatable, Codable, Sendable {
	var order: [String]
	var hidden: [String]

	static let empty = DashboardLayout(order: [], hidden: [])

	init(order: [String] = [], hidden: [String] = []) {
		self.order = Self.uniquing(order)
		self.hidden = Self.uniquing(hidden)
	}

	private enum CodingKeys: String, CodingKey {
		case order, hidden
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		order = Self.uniquing(try container.decodeIfPresent([String].self, forKey: .order) ?? [])
		hidden = Self.uniquing(try container.decodeIfPresent([String].self, forKey: .hidden) ?? [])
	}

	func encode(to encoder: Encoder) throws {
		var container = encoder.container(keyedBy: CodingKeys.self)
		try container.encode(order, forKey: .order)
		try container.encode(hidden, forKey: .hidden)
	}

	var hiddenSet: Set<String> { Set(hidden) }

	func isHidden(id: DashboardBlockID) -> Bool {
		hiddenSet.contains(id.rawValue)
	}

	func isVisible(id: DashboardBlockID) -> Bool {
		!isHidden(id: id)
	}

	/// Toggle membership in `hidden` without requiring the live registry.
	/// Used by Settings built-in toggles and init overrides.
	func settingVisibility(id: DashboardBlockID, visible: Bool) -> DashboardLayout {
		var nextHidden = hidden.filter { $0 != id.rawValue }
		var nextOrder = order
		if !visible {
			nextHidden.append(id.rawValue)
		}
		if !nextOrder.contains(id.rawValue) {
			nextOrder.append(id.rawValue)
		}
		return DashboardLayout(order: nextOrder, hidden: nextHidden)
	}

	func hiding(_ id: DashboardBlockID, from descriptors: [DashboardBlockDescriptor]) -> DashboardLayout {
		let visible = resolvedVisible(from: descriptors).filter { $0 != id }
		var hiddenIDs = resolvedHidden(from: descriptors)
		if !hiddenIDs.contains(id) {
			hiddenIDs.append(id)
		}
		return DashboardLayout(
			order: visible.map(\.rawValue) + hiddenIDs.map(\.rawValue),
			hidden: hiddenIDs.map(\.rawValue)
		)
	}

	/// Restores `id` into the visible list. `nil` index appends at the end.
	func showing(
		_ id: DashboardBlockID,
		at index: Int?,
		from descriptors: [DashboardBlockDescriptor]
	) -> DashboardLayout {
		var visible = resolvedVisible(from: descriptors)
		visible.removeAll { $0 == id }
		if let index {
			visible.insert(id, at: min(max(0, index), visible.count))
		} else {
			visible.append(id)
		}
		let hiddenIDs = resolvedHidden(from: descriptors).filter { $0 != id }
		return DashboardLayout(
			order: visible.map(\.rawValue) + hiddenIDs.map(\.rawValue),
			hidden: hiddenIDs.map(\.rawValue)
		)
	}

	func moving(
		_ id: DashboardBlockID,
		to index: Int,
		from descriptors: [DashboardBlockDescriptor]
	) -> DashboardLayout {
		var visible = resolvedVisible(from: descriptors)
		guard visible.contains(id) else { return self }
		visible.removeAll { $0 == id }
		visible.insert(id, at: min(max(0, index), visible.count))
		let hiddenIDs = resolvedHidden(from: descriptors)
		return DashboardLayout(
			order: visible.map(\.rawValue) + hiddenIDs.map(\.rawValue),
			hidden: hidden
		)
	}

	func resolvedVisible(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		resolvedSequence(from: descriptors).filter { !hiddenSet.contains($0.rawValue) }
	}

	func resolvedHidden(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		resolvedSequence(from: descriptors).filter { hiddenSet.contains($0.rawValue) }
	}

	/// Built-ins by `sortIndex`, then informational flows, then runners.
	static func defaultOrder(_ descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		let builtIns = descriptors.filter { !$0.isFlowBlock }.sorted { $0.sortIndex < $1.sortIndex }
		let informational = descriptors.filter { $0.isFlowBlock && !$0.isFlowRunner }
			.sorted { $0.sortIndex < $1.sortIndex }
		let runners = descriptors.filter(\.isFlowRunner).sorted { $0.sortIndex < $1.sortIndex }
		return (builtIns + informational + runners).map(\.id)
	}

	/// Load the JSON document, or migrate legacy per-block bool keys.
	static func load(from defaults: UserDefaults) -> DashboardLayout {
		if let raw = defaults.string(forKey: AppearanceDefaultsKey.dashboardLayout),
			let data = raw.data(using: .utf8),
			let decoded = try? JSONDecoder().decode(DashboardLayout.self, from: data)
		{
			return decoded
		}
		var hidden: [String] = []
		if defaults.object(forKey: AppearanceDefaultsKey.showDashboardEmail) != nil,
			defaults.bool(forKey: AppearanceDefaultsKey.showDashboardEmail) == false
		{
			hidden.append(DashboardBlockID.email.rawValue)
		}
		if defaults.object(forKey: AppearanceDefaultsKey.showDashboardTasks) != nil,
			defaults.bool(forKey: AppearanceDefaultsKey.showDashboardTasks) == false
		{
			hidden.append(DashboardBlockID.tasks.rawValue)
		}
		if defaults.object(forKey: AppearanceDefaultsKey.showDashboardCalendar) != nil,
			defaults.bool(forKey: AppearanceDefaultsKey.showDashboardCalendar) == false
		{
			hidden.append(DashboardBlockID.calendar.rawValue)
		}
		return DashboardLayout(order: [], hidden: hidden)
	}

	private func resolvedSequence(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		let registered = Set(descriptors.map(\.id.rawValue))
		let fallback = Self.defaultOrder(descriptors)
		var seen = Set<String>()
		var result: [DashboardBlockID] = []
		for raw in order where registered.contains(raw) && !seen.contains(raw) {
			result.append(DashboardBlockID(raw))
			seen.insert(raw)
		}
		for id in fallback where !seen.contains(id.rawValue) {
			result.append(id)
			seen.insert(id.rawValue)
		}
		return result
	}

	private static func uniquing(_ ids: [String]) -> [String] {
		var seen = Set<String>()
		return ids.filter { seen.insert($0).inserted }
	}
}

/// Reported card (or tray chip) frame in the dashboard edit coordinate space.
struct DashboardSlotFrame: Equatable, Sendable {
	var id: DashboardBlockID
	var frame: CGRect
}

enum DashboardDragGeometry {
	/// Index in `visible` of the slot under `point`, or the nearest slot center.
	/// When `requireHit` is true (tray origin, not yet inserted), returns `nil`
	/// unless `point` is inside a slot — and `nil` when it is inside `trayFrame`.
	static func targetIndex(
		at point: CGPoint,
		slots: [DashboardSlotFrame],
		visible: [DashboardBlockID],
		trayFrame: CGRect?,
		requireHit: Bool
	) -> Int? {
		if let trayFrame, trayFrame.contains(point), requireHit {
			return nil
		}
		if let hit = slots.first(where: { $0.frame.contains(point) }) {
			return visible.firstIndex(of: hit.id)
		}
		if requireHit {
			return nil
		}
		guard !slots.isEmpty else { return nil }
		let nearest = slots.min { lhs, rhs in
			distance(from: point, to: lhs.frame) < distance(from: point, to: rhs.frame)
		}
		guard let nearest else { return nil }
		return visible.firstIndex(of: nearest.id)
	}

	private static func distance(from point: CGPoint, to rect: CGRect) -> CGFloat {
		let center = CGPoint(x: rect.midX, y: rect.midY)
		let dx = point.x - center.x
		let dy = point.y - center.y
		return dx * dx + dy * dy
	}
}

enum DashboardEditSpace {
	static let name = "dashboard-edit"
}
