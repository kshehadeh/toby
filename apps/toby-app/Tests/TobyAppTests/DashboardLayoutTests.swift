import CoreGraphics
import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("DashboardLayout")
struct DashboardLayoutTests {
	private func flow(
		id: String,
		title: String,
		variant: String,
		sortIndex: Int
	) -> DashboardBlockDescriptor {
		DashboardBlockDescriptor.flow(
			FlowDashboardBlockInfo(
				id: id,
				flowId: id,
				title: title,
				description: title,
				variant: variant,
				refresh: nil,
				lastRanAt: nil,
				showsResultSheet: false
			),
			sortIndex: sortIndex
		)
	}

	private var registered: [DashboardBlockDescriptor] {
		DashboardBlockDescriptor.builtIn + [
			flow(id: "flow.info", title: "Inbox note", variant: "informational", sortIndex: 100),
			flow(id: "flow.run", title: "Focus mode", variant: "runner", sortIndex: 101),
		]
	}

	@Test("default order is built-ins then informational flows then runners")
	func defaultOrderGroupsVariants() {
		let order = DashboardLayout.defaultOrder(registered)
		#expect(order.map(\.rawValue) == ["email", "tasks", "calendar", "flow.info", "flow.run"])
	}

	@Test("empty layout shows all registered cards in default order")
	func emptyLayoutShowsDefault() {
		let layout = DashboardLayout.empty
		#expect(
			layout.resolvedVisible(from: registered).map(\.rawValue)
				== ["email", "tasks", "calendar", "flow.info", "flow.run"]
		)
		#expect(layout.resolvedHidden(from: registered).isEmpty)
	}

	@Test("unknown ids are ignored and new flows append visible")
	func unknownIdsIgnoredAndNewFlowsAppend() {
		let layout = DashboardLayout(
			order: ["email", "gone", "tasks"],
			hidden: ["gone", "calendar"]
		)
		#expect(layout.resolvedVisible(from: registered).map(\.rawValue) == [
			"email",
			"tasks",
			"flow.info",
			"flow.run",
		])
		#expect(layout.resolvedHidden(from: registered).map(\.rawValue) == ["calendar"])
	}

	@Test("custom order is preserved for registered ids")
	func customOrderPreserved() {
		let layout = DashboardLayout(order: ["calendar", "email", "flow.run", "tasks", "flow.info"])
		#expect(layout.resolvedVisible(from: registered).map(\.rawValue) == [
			"calendar",
			"email",
			"flow.run",
			"tasks",
			"flow.info",
		])
	}

	@Test("hide and show appending update visible and hidden lists")
	func hideAndShowAppending() {
		var layout = DashboardLayout.empty
		layout = layout.hiding(.email, from: registered)
		#expect(!layout.isVisible(id: .email))
		#expect(layout.resolvedVisible(from: registered).map(\.rawValue) == [
			"tasks",
			"calendar",
			"flow.info",
			"flow.run",
		])
		#expect(layout.resolvedHidden(from: registered).map(\.rawValue) == ["email"])

		layout = layout.showing(.email, at: nil, from: registered)
		#expect(layout.isVisible(id: .email))
		#expect(layout.resolvedVisible(from: registered).last == .email)
	}

	@Test("show at index inserts into the visible list")
	func showAtIndexInserts() {
		var layout = DashboardLayout.empty.hiding(.calendar, from: registered)
		layout = layout.showing(.calendar, at: 1, from: registered)
		#expect(layout.resolvedVisible(from: registered).map(\.rawValue) == [
			"email",
			"calendar",
			"tasks",
			"flow.info",
			"flow.run",
		])
	}

	@Test("moving a visible card reorders it")
	func movingReorders() {
		let layout = DashboardLayout.empty.moving(.calendar, to: 0, from: registered)
		#expect(layout.resolvedVisible(from: registered).first == .calendar)
		#expect(layout.resolvedVisible(from: registered).map(\.rawValue) == [
			"calendar",
			"email",
			"tasks",
			"flow.info",
			"flow.run",
		])
	}

	@Test("settingVisibility toggles built-in and flow ids")
	func settingVisibilityTogglesAnyId() {
		var layout = DashboardLayout.empty
		layout = layout.settingVisibility(id: .email, visible: false)
		#expect(!layout.isVisible(id: .email))
		layout = layout.settingVisibility(id: DashboardBlockID("flow.info"), visible: false)
		#expect(!layout.isVisible(id: DashboardBlockID("flow.info")))
		layout = layout.settingVisibility(id: .email, visible: true)
		#expect(layout.isVisible(id: .email))
	}

	@Test("migrates legacy per-block bools when JSON is absent")
	func migratesLegacyBools() {
		let suite = UserDefaults(suiteName: "toby.tests.layout.migrate.\(UUID().uuidString)")!
		suite.set(false, forKey: AppearanceDefaultsKey.showDashboardEmail)
		suite.set(true, forKey: AppearanceDefaultsKey.showDashboardTasks)
		suite.set(false, forKey: AppearanceDefaultsKey.showDashboardCalendar)
		let layout = DashboardLayout.load(from: suite)
		#expect(layout.hidden.contains("email"))
		#expect(layout.hidden.contains("calendar"))
		#expect(!layout.hidden.contains("tasks"))
		#expect(layout.order.isEmpty)
	}

	@Test("legacy layout JSON defaults the Actions pane to visible at default width")
	func legacyJSONDefaultsActionsPane() throws {
		let json = """
		{"order":["email","tasks"],"hidden":["calendar"]}
		""".data(using: .utf8)!
		let layout = try JSONDecoder().decode(DashboardLayout.self, from: json)
		#expect(layout.order == ["email", "tasks"])
		#expect(layout.hidden == ["calendar"])
		#expect(layout.actionsVisible)
		#expect(layout.actionsWidth == DashboardBlockLayout.actionsRailDefaultWidth)
	}

	@Test("actions width is clamped and card mutations keep pane fields")
	func actionsPaneFieldsSurviveCardMutation() {
		let wide = DashboardLayout.clampedActionsWidth(999)
		#expect(wide == DashboardBlockLayout.actionsRailMaxWidth)
		#expect(DashboardLayout.clampedActionsWidth(10) == DashboardBlockLayout.actionsRailMinWidth)
		#expect(
			DashboardLayout.clampedActionsWidth(.infinity)
				== DashboardBlockLayout.actionsRailDefaultWidth
		)

		var layout = DashboardLayout(
			order: ["email"],
			hidden: [],
			actionsVisible: false,
			actionsWidth: 200
		)
		layout = layout.settingVisibility(id: .tasks, visible: false)
		#expect(!layout.actionsVisible)
		#expect(layout.actionsWidth == 200)
		layout = layout.hiding(.email, from: registered)
		#expect(!layout.actionsVisible)
		#expect(layout.actionsWidth == 200)
	}

	@Test("JSON document wins over legacy bools")
	func jsonWinsOverLegacyBools() throws {
		let suite = UserDefaults(suiteName: "toby.tests.layout.json.\(UUID().uuidString)")!
		suite.set(false, forKey: AppearanceDefaultsKey.showDashboardEmail)
		let stored = DashboardLayout(order: ["tasks", "email"], hidden: ["tasks"])
		let data = try JSONEncoder().encode(stored)
		suite.set(String(data: data, encoding: .utf8), forKey: AppearanceDefaultsKey.dashboardLayout)
		let layout = DashboardLayout.load(from: suite)
		#expect(layout.hidden == ["tasks"])
		#expect(layout.order == ["tasks", "email"])
	}

	@Test("visible cards omit runners and visible runners omit cards")
	func visibleCardsAndRunnersSplit() {
		let layout = DashboardLayout.empty
		#expect(
			layout.resolvedVisibleCards(from: registered).map(\.rawValue)
				== ["email", "tasks", "calendar", "flow.info"]
		)
		#expect(
			layout.resolvedVisibleRunners(from: registered).map(\.rawValue)
				== ["flow.run"]
		)

		let mixed = DashboardLayout(order: ["calendar", "flow.run", "email", "tasks", "flow.info"])
		#expect(mixed.resolvedVisibleCards(from: registered).map(\.rawValue) == [
			"calendar",
			"email",
			"tasks",
			"flow.info",
		])
		#expect(mixed.resolvedVisibleRunners(from: registered).map(\.rawValue) == ["flow.run"])

		let hiddenRunner = DashboardLayout(order: [], hidden: ["flow.run"])
		#expect(hiddenRunner.resolvedVisibleRunners(from: registered).isEmpty)
		#expect(hiddenRunner.resolvedHidden(from: registered).map(\.rawValue) == ["flow.run"])
	}

	@Test("placingVisibleCards reorders informational cards and ignores runners")
	func placingVisibleCardsReordersAndIgnoresRunners() {
		let start = DashboardLayout.empty
		let moved = start.placingVisibleCards(
			[.email],
			at: .before(.calendar),
			from: registered
		)
		#expect(moved.resolvedVisibleCards(from: registered).map(\.rawValue) == [
			"tasks",
			"email",
			"calendar",
			"flow.info",
		])
		#expect(moved.resolvedVisibleRunners(from: registered).map(\.rawValue) == ["flow.run"])

		let ignored = start.placingVisibleCards(
			[DashboardBlockID("flow.run")],
			at: .before(.email),
			from: registered
		)
		#expect(ignored == start)
	}

	@Test("insert-before hit testing prefers containing slot then padded nearest")
	func insertBeforeGeometry() {
		let frames: [DashboardBlockID: CGRect] = [
			.email: CGRect(x: 0, y: 0, width: 100, height: 80),
			.tasks: CGRect(x: 120, y: 0, width: 100, height: 80),
			.calendar: CGRect(x: 240, y: 0, width: 100, height: 80),
		]
		#expect(
			DashboardDropGeometry.insertBeforeID(
				at: CGPoint(x: 150, y: 40),
				frames: frames,
				draggingID: .email
			) == .tasks
		)
		#expect(
			DashboardDropGeometry.insertBeforeID(
				at: CGPoint(x: 112, y: 40),
				frames: frames,
				draggingID: .email
			) == .tasks
		)
		#expect(
			DashboardDropGeometry.insertBeforeID(
				at: CGPoint(x: 50, y: 40),
				frames: frames,
				draggingID: .email
			) == nil
		)
	}

	@Test("placingVisibleCards shows a hidden card before a target or at end")
	func placingVisibleCardsShowsHidden() {
		let hidden = DashboardLayout.empty.hiding(.email, from: registered)
		let beforeTasks = hidden.placingVisibleCards([.email], at: .before(.tasks), from: registered)
		#expect(beforeTasks.resolvedVisibleCards(from: registered).map(\.rawValue) == [
			"email",
			"tasks",
			"calendar",
			"flow.info",
		])
		#expect(!beforeTasks.isHidden(id: .email))

		let atEnd = hidden.placingVisibleCards([.email], at: .end, from: registered)
		#expect(atEnd.resolvedVisibleCards(from: registered).last == .email)
	}

	@Test("adaptive column count stays finite for infinite and NaN widths")
	func adaptiveColumnCountIgnoresNonFiniteWidth() {
		#expect(
			AdaptiveColumnLayout.columnCount(
				containerWidth: .infinity,
				minItemWidth: 280,
				spacing: 20
			) == 1
		)
		#expect(
			AdaptiveColumnLayout.columnCount(
				containerWidth: -.infinity,
				minItemWidth: 280,
				spacing: 20
			) == 1
		)
		#expect(
			AdaptiveColumnLayout.columnCount(
				containerWidth: .nan,
				minItemWidth: 280,
				spacing: 20
			) == 1
		)
		#expect(
			AdaptiveColumnLayout.resolvedWidth(nil, minItemWidth: 280) == 280
		)
		#expect(
			AdaptiveColumnLayout.columnCount(
				containerWidth: 900,
				minItemWidth: 280,
				spacing: 20,
				itemCount: 3
			) == 3
		)
	}
}
