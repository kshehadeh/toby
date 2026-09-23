import Foundation

/// App-local home-dashboard layout: card order, hidden cards, and the Actions
/// rail (visibility + width).
///
/// Persisted in `UserDefaults` with other UI prefs (not daemon / `~/.toby` config).
/// An empty `order` means “use the default grouping” (built-ins, then
/// informational flows, then runners). Unknown ids are ignored; newly
/// registered cards that are not listed append as visible.
struct DashboardLayout: Equatable, Codable, Sendable {
	var order: [String]
	var hidden: [String]
	/// When false, the Actions rail is collapsed (toolbar toggle). Independent
	/// of per-runner hide. Default on.
	var actionsVisible: Bool
	/// Width of the Actions rail, clamped to `DashboardBlockLayout` min/max.
	var actionsWidth: CGFloat

	static let empty = DashboardLayout()

	init(
		order: [String] = [],
		hidden: [String] = [],
		actionsVisible: Bool = true,
		actionsWidth: CGFloat = DashboardBlockLayout.actionsRailDefaultWidth
	) {
		self.order = Self.uniquing(order)
		self.hidden = Self.uniquing(hidden)
		self.actionsVisible = actionsVisible
		self.actionsWidth = Self.clampedActionsWidth(actionsWidth)
	}

	private enum CodingKeys: String, CodingKey {
		case order, hidden, actionsVisible, actionsWidth
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		order = Self.uniquing(try container.decodeIfPresent([String].self, forKey: .order) ?? [])
		hidden = Self.uniquing(try container.decodeIfPresent([String].self, forKey: .hidden) ?? [])
		actionsVisible = try container.decodeIfPresent(Bool.self, forKey: .actionsVisible) ?? true
		let width = try container.decodeIfPresent(Double.self, forKey: .actionsWidth)
		actionsWidth = Self.clampedActionsWidth(
			width.map { CGFloat($0) } ?? DashboardBlockLayout.actionsRailDefaultWidth
		)
	}

	func encode(to encoder: Encoder) throws {
		var container = encoder.container(keyedBy: CodingKeys.self)
		try container.encode(order, forKey: .order)
		try container.encode(hidden, forKey: .hidden)
		try container.encode(actionsVisible, forKey: .actionsVisible)
		try container.encode(Double(actionsWidth), forKey: .actionsWidth)
	}

	static func clampedActionsWidth(_ width: CGFloat) -> CGFloat {
		guard width.isFinite else { return DashboardBlockLayout.actionsRailDefaultWidth }
		return min(
			DashboardBlockLayout.actionsRailMaxWidth,
			max(DashboardBlockLayout.actionsRailMinWidth, width)
		)
	}

	/// Copy with a new order/hidden list, keeping the Actions pane fields.
	func withCards(order: [String], hidden: [String]) -> DashboardLayout {
		DashboardLayout(
			order: order,
			hidden: hidden,
			actionsVisible: actionsVisible,
			actionsWidth: actionsWidth
		)
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
		return withCards(order: nextOrder, hidden: nextHidden)
	}

	func hiding(_ id: DashboardBlockID, from descriptors: [DashboardBlockDescriptor]) -> DashboardLayout {
		let visible = resolvedVisible(from: descriptors).filter { $0 != id }
		var hiddenIDs = resolvedHidden(from: descriptors)
		if !hiddenIDs.contains(id) {
			hiddenIDs.append(id)
		}
		return withCards(
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
		return withCards(
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
		return withCards(
			order: visible.map(\.rawValue) + hiddenIDs.map(\.rawValue),
			hidden: hidden
		)
	}

	/// Where to insert cards in the informational grid (not the Actions rail).
	enum CardPlacement: Equatable, Sendable {
		/// Immediately before this visible card.
		case before(DashboardBlockID)
		/// After the last visible card.
		case end
	}

	/// Shows (if hidden) and reorders informational cards. Runner ids are ignored
	/// so the Actions rail cannot mix with the home grid.
	func placingVisibleCards(
		_ ids: [DashboardBlockID],
		at placement: CardPlacement,
		from descriptors: [DashboardBlockDescriptor]
	) -> DashboardLayout {
		let allowed = ids.filter { id in
			descriptors.contains { $0.id == id && !$0.isFlowRunner }
		}
		guard !allowed.isEmpty else { return self }

		var cards = resolvedVisibleCards(from: descriptors)
		cards.removeAll { allowed.contains($0) }
		switch placement {
		case let .before(destination):
			if let index = cards.firstIndex(of: destination) {
				cards.insert(contentsOf: allowed, at: index)
			} else {
				cards.append(contentsOf: allowed)
			}
		case .end:
			cards.append(contentsOf: allowed)
		}

		let runners = resolvedVisibleRunners(from: descriptors)
		let hiddenIDs = resolvedHidden(from: descriptors).filter { !allowed.contains($0) }
		return withCards(
			order: cards.map(\.rawValue) + runners.map(\.rawValue) + hiddenIDs.map(\.rawValue),
			hidden: hiddenIDs.map(\.rawValue)
		)
	}

	func resolvedVisible(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		resolvedSequence(from: descriptors).filter { !hiddenSet.contains($0.rawValue) }
	}

	func resolvedHidden(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		resolvedSequence(from: descriptors).filter { hiddenSet.contains($0.rawValue) }
	}

	/// Informational / built-in cards only (runners live in the Actions rail).
	func resolvedVisibleCards(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		resolvedVisible(from: descriptors).filter { id in
			!(descriptors.first { $0.id == id }?.isFlowRunner ?? false)
		}
	}

	/// Runner-variant flows shown in the Actions rail.
	func resolvedVisibleRunners(from descriptors: [DashboardBlockDescriptor]) -> [DashboardBlockID] {
		resolvedVisible(from: descriptors).filter { id in
			descriptors.first { $0.id == id }?.isFlowRunner ?? false
		}
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
