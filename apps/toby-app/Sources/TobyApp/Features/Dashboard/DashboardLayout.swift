import Foundation

/// App-local Home layout for the Actions rail: hidden tiles, per-tile color
/// overrides, and the rail's visibility + width.
///
/// Persisted in `UserDefaults` with other UI prefs (not daemon / `~/.toby` config).
/// Older documents also stored a card `order`; it is ignored when decoding.
struct DashboardLayout: Equatable, Codable, Sendable {
	var hidden: [String]
	var colorOverrides: [String: String]
	/// When false, the Actions rail is collapsed (toolbar toggle). Independent
	/// of per-tile hide. Default on.
	var actionsVisible: Bool
	/// Width of the Actions rail, clamped to `DashboardBlockLayout` min/max.
	var actionsWidth: CGFloat

	static let empty = DashboardLayout()

	init(
		hidden: [String] = [],
		colorOverrides: [String: String] = [:],
		actionsVisible: Bool = true,
		actionsWidth: CGFloat = DashboardBlockLayout.actionsRailDefaultWidth
	) {
		self.hidden = Self.uniquing(hidden)
		self.colorOverrides = colorOverrides.filter { DashboardBlockColor.validated($0.value) != nil }
		self.actionsVisible = actionsVisible
		self.actionsWidth = Self.clampedActionsWidth(actionsWidth)
	}

	private enum CodingKeys: String, CodingKey {
		case hidden, colorOverrides, actionsVisible, actionsWidth
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		hidden = Self.uniquing(try container.decodeIfPresent([String].self, forKey: .hidden) ?? [])
		colorOverrides = (try container.decodeIfPresent([String: String].self, forKey: .colorOverrides) ?? [:])
			.filter { DashboardBlockColor.validated($0.value) != nil }
		actionsVisible = try container.decodeIfPresent(Bool.self, forKey: .actionsVisible) ?? true
		let width = try container.decodeIfPresent(Double.self, forKey: .actionsWidth)
		actionsWidth = Self.clampedActionsWidth(
			width.map { CGFloat($0) } ?? DashboardBlockLayout.actionsRailDefaultWidth
		)
	}

	func encode(to encoder: Encoder) throws {
		var container = encoder.container(keyedBy: CodingKeys.self)
		try container.encode(hidden, forKey: .hidden)
		try container.encode(colorOverrides, forKey: .colorOverrides)
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

	func settingColor(_ color: String?, for id: DashboardBlockID) -> DashboardLayout {
		var next = self
		next.colorOverrides[id.rawValue] = DashboardBlockColor.validated(color)
		return next
	}

	func resolvedColor(for id: DashboardBlockID, defaultColor: String?) -> String? {
		DashboardBlockColor.validated(colorOverrides[id.rawValue]) ?? DashboardBlockColor.validated(defaultColor)
	}

	func isHidden(id: DashboardBlockID) -> Bool {
		hidden.contains(id.rawValue)
	}

	func isVisible(id: DashboardBlockID) -> Bool {
		!isHidden(id: id)
	}

	/// Toggle membership in `hidden`.
	func settingVisibility(id: DashboardBlockID, visible: Bool) -> DashboardLayout {
		var next = self
		next.hidden.removeAll { $0 == id.rawValue }
		if !visible {
			next.hidden.append(id.rawValue)
		}
		return next
	}

	/// Load the JSON document (empty when missing or unreadable).
	static func load(from defaults: UserDefaults) -> DashboardLayout {
		guard let raw = defaults.string(forKey: AppearanceDefaultsKey.dashboardLayout),
			let data = raw.data(using: .utf8),
			let decoded = try? JSONDecoder().decode(DashboardLayout.self, from: data)
		else { return .empty }
		return decoded
	}

	private static func uniquing(_ ids: [String]) -> [String] {
		var seen = Set<String>()
		return ids.filter { seen.insert($0).inserted }
	}
}
