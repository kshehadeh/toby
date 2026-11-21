import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("DashboardLayout")
struct DashboardLayoutTests {
	private let focus = DashboardBlockID("flow.focus")
	private let wrapUp = DashboardBlockID("flow.wrap-up")

	@Test("empty layout hides nothing and shows the Actions rail at default width")
	func emptyLayoutDefaults() {
		let layout = DashboardLayout.empty
		#expect(layout.hidden.isEmpty)
		#expect(layout.colorOverrides.isEmpty)
		#expect(layout.isVisible(id: focus))
		#expect(layout.actionsVisible)
		#expect(layout.actionsWidth == DashboardBlockLayout.actionsRailDefaultWidth)
	}

	@Test("settingVisibility hides and shows a tile without duplicates")
	func settingVisibilityToggles() {
		var layout = DashboardLayout.empty.settingVisibility(id: focus, visible: false)
		layout = layout.settingVisibility(id: focus, visible: false)
		#expect(layout.hidden == ["flow.focus"])
		#expect(layout.isHidden(id: focus))
		#expect(layout.isVisible(id: wrapUp))
		layout = layout.settingVisibility(id: focus, visible: true)
		#expect(layout.hidden.isEmpty)
	}

	@Test("legacy layout JSON keeps hidden ids, ignores card order, and defaults the Actions pane")
	func legacyJSONDecodes() throws {
		let json = """
		{"order":["email","tasks"],"hidden":["calendar","flow.focus"]}
		""".data(using: .utf8)!
		let layout = try JSONDecoder().decode(DashboardLayout.self, from: json)
		#expect(layout.hidden == ["calendar", "flow.focus"])
		#expect(layout.actionsVisible)
		#expect(layout.actionsWidth == DashboardBlockLayout.actionsRailDefaultWidth)

		let encoded = String(data: try JSONEncoder().encode(layout), encoding: .utf8) ?? ""
		#expect(!encoded.contains("order"))
	}

	@Test("actions width is clamped and visibility changes keep pane fields")
	func actionsPaneFieldsSurviveVisibilityChanges() {
		#expect(DashboardLayout.clampedActionsWidth(999) == DashboardBlockLayout.actionsRailMaxWidth)
		#expect(DashboardLayout.clampedActionsWidth(10) == DashboardBlockLayout.actionsRailMinWidth)
		#expect(
			DashboardLayout.clampedActionsWidth(.infinity)
				== DashboardBlockLayout.actionsRailDefaultWidth
		)

		var layout = DashboardLayout(hidden: [], actionsVisible: false, actionsWidth: 200)
		layout = layout.settingVisibility(id: focus, visible: false)
		#expect(!layout.actionsVisible)
		#expect(layout.actionsWidth == 200)
	}

	@Test("load reads the stored document and falls back to empty")
	func loadFromDefaults() throws {
		let suite = UserDefaults(suiteName: "toby.tests.layout.json.\(UUID().uuidString)")!
		#expect(DashboardLayout.load(from: suite) == .empty)

		let stored = DashboardLayout(hidden: ["flow.focus"], colorOverrides: ["flow.focus": "blue"])
		let data = try JSONEncoder().encode(stored)
		suite.set(String(data: data, encoding: .utf8), forKey: AppearanceDefaultsKey.dashboardLayout)
		#expect(DashboardLayout.load(from: suite) == stored)

		suite.set("not json", forKey: AppearanceDefaultsKey.dashboardLayout)
		#expect(DashboardLayout.load(from: suite) == .empty)
	}
}
