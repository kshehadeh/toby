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

	@Test("visibleIndex maps a runner region index onto the full list")
	func visibleIndexKeepsKindsSeparate() {
		let visible: [DashboardBlockID] = [
			.email, .tasks, .calendar, DashboardBlockID("flow.info"), DashboardBlockID("flow.run"),
		]
		let runner = DashboardBlockID("flow.run")
		#expect(
			DashboardLayout.visibleIndex(
				forRegionIndex: 0,
				draggingID: runner,
				visible: visible,
				descriptors: registered
			) == 4
		)
		#expect(
			DashboardLayout.visibleIndex(
				forRegionIndex: 1,
				draggingID: .email,
				visible: visible,
				descriptors: registered
			) == 1
		)
	}

	@Test("drag geometry hits containing slot then nearest center")
	func dragGeometryHitAndNearest() {
		let slots = [
			DashboardSlotFrame(id: .email, frame: CGRect(x: 0, y: 0, width: 100, height: 100)),
			DashboardSlotFrame(id: .tasks, frame: CGRect(x: 120, y: 0, width: 100, height: 100)),
		]
		let visible: [DashboardBlockID] = [.email, .tasks]
		#expect(
			DashboardDragGeometry.targetIndex(
				at: CGPoint(x: 130, y: 10),
				slots: slots,
				visible: visible,
				trayFrame: nil,
				requireHit: false
			) == 1
		)
		#expect(
			DashboardDragGeometry.targetIndex(
				at: CGPoint(x: 400, y: 400),
				slots: slots,
				visible: visible,
				trayFrame: CGRect(x: 0, y: 200, width: 400, height: 80),
				requireHit: true
			) == nil
		)
		#expect(
			DashboardDragGeometry.targetIndex(
				at: CGPoint(x: 10, y: 220),
				slots: slots,
				visible: visible,
				trayFrame: CGRect(x: 0, y: 200, width: 400, height: 80),
				requireHit: true
			) == nil
		)
	}
}

@MainActor
@Suite("DashboardLayoutEditor")
struct DashboardLayoutEditorTests {
	private var descriptors: [DashboardBlockDescriptor] {
		DashboardBlockDescriptor.builtIn
	}

	@Test("hide updates draft and cancel restores a drag snapshot")
	func hideAndCancelDrag() {
		let editor = DashboardLayoutEditor()
		editor.sync(from: .empty)
		let hidden = editor.hide(.email, from: descriptors)
		#expect(!hidden.isVisible(id: .email))

		editor.beginDrag(id: .tasks, fromTray: false, location: .zero)
		editor.updateDrag(
			location: CGPoint(x: 10, y: 10),
			slots: [
				DashboardSlotFrame(id: .tasks, frame: CGRect(x: 0, y: 0, width: 80, height: 80)),
				DashboardSlotFrame(id: .calendar, frame: CGRect(x: 0, y: 0, width: 80, height: 80)),
			],
			trayFrame: nil,
			descriptors: descriptors
		)
		#expect(editor.isDragging)
		editor.cancelDrag()
		#expect(!editor.isDragging)
		#expect(!editor.draft.isVisible(id: .email))
		#expect(editor.draft.isVisible(id: .tasks))
	}

	@Test("drop commits draft; tray drag without a slot does not")
	func dropCommitsAndTrayCancel() {
		let editor = DashboardLayoutEditor()
		let start = DashboardLayout.empty.hiding(.calendar, from: descriptors)
		editor.sync(from: start)

		editor.beginDrag(id: .email, fromTray: false, location: .zero)
		let slots = [
			DashboardSlotFrame(id: .email, frame: CGRect(x: 0, y: 0, width: 100, height: 100)),
			DashboardSlotFrame(id: .tasks, frame: CGRect(x: 0, y: 0, width: 100, height: 100)),
		]
		editor.updateDrag(
			location: CGPoint(x: 10, y: 10),
			slots: slots,
			trayFrame: nil,
			descriptors: descriptors
		)
		let committed = editor.endDrag(commit: true)
		#expect(committed != nil)

		editor.sync(from: start)
		editor.beginDrag(id: .calendar, fromTray: true, location: CGPoint(x: 5, y: 205))
		let none = editor.endDrag(commit: true)
		#expect(none == nil)
		#expect(editor.draft.isHidden(id: .calendar))
	}

	@Test("updateDrag moves the dragged card onto the hovered slot")
	func updateDragMovesToHoveredSlot() {
		let editor = DashboardLayoutEditor()
		editor.sync(from: .empty)
		editor.beginDrag(id: .email, fromTray: false, location: CGPoint(x: 10, y: 10))
		editor.updateDrag(
			location: CGPoint(x: 150, y: 10),
			slots: [
				DashboardSlotFrame(id: .email, frame: CGRect(x: 0, y: 0, width: 100, height: 100)),
				DashboardSlotFrame(id: .tasks, frame: CGRect(x: 120, y: 0, width: 100, height: 100)),
			],
			trayFrame: nil,
			descriptors: descriptors
		)
		#expect(editor.draft.resolvedVisible(from: descriptors).map(\.rawValue) == [
			"tasks",
			"email",
			"calendar",
		])
		editor.cancelDrag()
	}

	@Test("show appending restores a hidden card at the end")
	func showAppendingRestoresAtEnd() {
		let editor = DashboardLayoutEditor()
		editor.sync(from: DashboardLayout.empty.hiding(.email, from: descriptors))
		let next = editor.showAppending(.email, from: descriptors)
		#expect(next.resolvedVisible(from: descriptors).last == .email)
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

	@Test("dragging a runner over a card slot does not mix kinds")
	func runnerDragIgnoresCardSlots() {
		let runner = DashboardBlockDescriptor.flow(
			FlowDashboardBlockInfo(
				id: "flow.run",
				flowId: "flow.run",
				title: "Focus mode",
				description: "Turn off Wi-Fi",
				variant: "runner",
				lastRanAt: nil,
				showsResultSheet: false
			),
			sortIndex: 101
		)
		let all = DashboardBlockDescriptor.builtIn + [runner]
		let editor = DashboardLayoutEditor()
		editor.sync(from: .empty)
		editor.beginDrag(id: DashboardBlockID("flow.run"), fromTray: false, location: CGPoint(x: 10, y: 10))
		editor.updateDrag(
			location: CGPoint(x: 10, y: 10),
			slots: [
				DashboardSlotFrame(id: .email, frame: CGRect(x: 0, y: 0, width: 100, height: 100)),
				DashboardSlotFrame(
					id: DashboardBlockID("flow.run"),
					frame: CGRect(x: 400, y: 0, width: 80, height: 40)
				),
			],
			trayFrame: nil,
			descriptors: all
		)
		#expect(editor.draft.resolvedVisible(from: all).map(\.rawValue) == [
			"email",
			"tasks",
			"calendar",
			"flow.run",
		])
		editor.cancelDrag()
	}
}
