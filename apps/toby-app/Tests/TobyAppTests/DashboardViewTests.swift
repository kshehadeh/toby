import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("DashboardModels")
struct DashboardModelsTests {
	@Test("onboarding checklist counts completed steps")
	func onboardingChecklistCounts() {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
		#expect(checklist.completedCount == 3)
		#expect(checklist.totalCount == 8)
		#expect(checklist.isComplete == false)
		#expect(checklist.progress == 3.0 / 8.0)
		#expect(checklist.upNextKind == .grantPermissions)
	}

	@Test("onboarding checklist is complete when all steps done")
	func onboardingChecklistComplete() {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: true,
			hasSchedule: true,
			hasSkill: true,
			hasRecording: true,
			hasSession: true
		)
		#expect(checklist.isComplete)
		#expect(checklist.completedCount == 8)
		#expect(checklist.upNextKind == nil)
	}

	@Test("onboarding steps include subtitles and app icons")
	func onboardingStepsIncludeSubtitlesAndIcons() {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: false,
			hasModelConfigured: false,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
		#expect(checklist.upNextKind == .connectIntegrations)
		let ai = checklist.steps.first { $0.kind == .configureAIProvider }
		#expect(ai?.subtitle == "One account for every AI model Toby uses")
		#expect(ai?.systemImage == "cpu")
		#expect(ai?.isComplete == true)
		#expect(ai?.actionLabel == "Connect")
		let integrations = checklist.steps.first { $0.kind == .connectIntegrations }
		#expect(integrations?.systemImage == "puzzlepiece.extension")
		let skills = checklist.steps.first { $0.kind == .createSkill }
		#expect(skills?.systemImage == DetailRoute.skills.systemImage)
	}

	@Test("due text falls back to no due date")
	func dueTextNoDueDate() {
		#expect(DashboardFormat.dueText(nil).text == "No due date")
	}

	@Test("flow ran-at text uses short date and HH:mm")
	func flowRanAtTextFormatsShortDateAndTime() {
		#expect(DashboardFormat.flowRanAtText(nil) == nil)
		#expect(DashboardFormat.flowRanAtText("not-a-date") == nil)
		// Fixed ISO instant: 2026-07-20 14:05 UTC
		let formatted = DashboardFormat.flowRanAtText("2026-07-20T14:05:00Z")
		#expect(formatted != nil)
		// Time portion is always 24h HH:mm in local calendar; date is locale short.
		#expect(formatted!.contains(":"))
		let timeSuffix = formatted!.split(separator: " ").last.map(String.init)
		#expect(timeSuffix?.count == 5) // HH:mm
		#expect(timeSuffix?.contains(":") == true)
	}

	@Test("dashboard store initializes empty")
	func dashboardStoreInitializesEmpty() {
		let store = DashboardStore()
		#expect(store.blocks.isEmpty)
		#expect(store.isRefreshing == false)
		#expect(store.hasLoadedOnce == false)
	}
}

@MainActor
@Suite("DashboardNavigation")
struct DashboardNavigationTests {
	@Test("detail route includes dashboard case")
	func detailRouteIncludesDashboard() {
		#expect(DetailRoute.allCases.contains(.dashboard))
	}

	@Test("dashboard route uses Home as the UI label and house icon")
	func dashboardRouteUsesHomeUI() {
		#expect(DetailRoute.dashboard.menuTitle == "Home")
		#expect(DetailRoute.dashboard.systemImage == "house")
	}

	@Test("dashboard is the default route")
	func dashboardIsDefaultRoute() {
		let history = NavigationHistory()
		#expect(history.current == .dashboard)
	}

	@Test("greeting prefix reflects time of day")
	func greetingPrefixReflectsTime() {
		var components = DateComponents()
		components.year = 2026
		components.month = 7
		components.day = 5
		components.hour = 9
		let morning = Calendar.current.date(from: components)!
		#expect(DashboardView.greetingPrefix(for: morning) == "Good morning")
		components.hour = 20
		let evening = Calendar.current.date(from: components)!
		#expect(DashboardView.greetingPrefix(for: evening) == "Good evening")
	}

	@Test("userName uses first word of First Last format")
	func userNameFromFirstLast() {
		#expect(DashboardView.userName(from: "Karim Shehadeh") == "Karim")
		#expect(DashboardView.userName(from: "Karim") == "Karim")
	}

	@Test("userName uses first name after comma for Last, First format")
	func userNameFromLastCommaFirst() {
		#expect(DashboardView.userName(from: "Shehadeh, Karim") == "Karim")
		#expect(DashboardView.userName(from: "Shehadeh, Karim A.") == "Karim")
		#expect(DashboardView.userName(from: "  Shehadeh,  Karim  ") == "Karim")
	}

	@Test("userName falls back to there when empty")
	func userNameEmptyFallback() {
		#expect(DashboardView.userName(from: "") == "there")
		#expect(DashboardView.userName(from: "   ") == "there")
	}
}

@MainActor
@Suite("DashboardView")
struct DashboardViewTests {
	private func makeAppearance(hideOnboarding: Bool = false) -> AppearancePreferences {
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.\(UUID().uuidString)")!
		return AppearancePreferences(hideOnboarding: hideOnboarding, defaults: suite)
	}

	private func incompleteChecklist() -> OnboardingChecklist {
		OnboardingChecklist.make(
			hasConfiguredAIProvider: false,
			hasConnectedIntegrations: false,
			hasModelConfigured: false,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
	}

	private func makeView(
		store: DashboardStore,
		appearance: AppearancePreferences? = nil,
		isEditing: Bool = false
	) -> DashboardView {
		DashboardView(
			store: store,
			userName: "Karim",
			onboarding: OnboardingChecklist.make(
				hasConfiguredAIProvider: true,
				hasConnectedIntegrations: true,
				hasModelConfigured: true,
				hasRequiredPermissions: false,
				hasSchedule: false,
				hasSkill: false,
				hasRecording: false,
				hasSession: false
			),
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: appearance ?? makeAppearance(),
			isEditing: isEditing
		)
	}

	@Test("dashboard view renders greeting")
	func dashboardViewRendersGreeting() throws {
		let view = makeView(store: DashboardStore())
		let expected = "\(DashboardView.greetingPrefix(for: Date())), Karim"
		#expect(throws: Never.self) {
			try view.inspect().find(text: expected)
		}
	}

	@Test("dashboard greeting omits page-level updated timestamp")
	func dashboardGreetingOmitsUpdatedTimestamp() throws {
		let view = makeView(store: DashboardStore())
		let updatedLabels = try view.inspect().findAll(ViewType.Text.self).filter {
			(try? $0.string().hasPrefix("Updated ")) == true
		}
		#expect(updatedLabels.isEmpty)
	}

	@Test("onboarding card renders title")
	func onboardingCardRendersTitle() throws {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
		let card = OnboardingCard(checklist: checklist, onStepAction: { _ in }, onHide: {})
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Finish setting up Toby")
		}
	}

	@Test("onboarding card hide control invokes hide")
	func onboardingCardHideInvokesCallback() throws {
		var didHide = false
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
		let card = OnboardingCard(checklist: checklist, onStepAction: { _ in }) {
			didHide = true
		}
		try card.inspect().find(button: "Hide").tap()
		#expect(didHide)
	}

	@Test("onboarding card shows up next and completed states")
	func onboardingCardShowsUpNextAndCompleted() throws {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: false,
			hasModelConfigured: false,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
		let card = OnboardingCard(checklist: checklist, onStepAction: { _ in }, onHide: {})
		#expect(throws: Never.self) {
			try card.inspect().find(text: "UP NEXT")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Completed")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(text: " of 9 done")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(text: "One account for every AI model Toby uses")
		}
	}

	@Test("dashboard hides onboarding until ready even when checklist incomplete")
	func dashboardHidesOnboardingUntilReady() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: false,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance()
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-onboarding-card")
		}
	}

	@Test("dashboard shows onboarding when ready and incomplete")
	func dashboardShowsOnboardingWhenReady() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance()
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-onboarding-card")
		}
	}

	@Test("hide onboarding button stores the home preference")
	func hideOnboardingButtonStoresPreference() throws {
		let prefs = makeAppearance()
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: prefs
		)
		try view.inspect().find(
			viewWithAccessibilityIdentifier: "dashboard-hide-onboarding-button"
		).button().tap()
		#expect(prefs.hideOnboarding == true)
	}

	@Test("dashboard hides onboarding when hide preference is enabled")
	func dashboardHidesOnboardingWhenPreferenceEnabled() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance(hideOnboarding: true)
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-onboarding-card")
		}
	}

	private func runnerStore(_ ids: [String]) -> DashboardStore {
		let store = DashboardStore()
		store.registry.syncFlowBlocks(ids.map { id in
			FlowDashboardBlockInfo(
				id: id,
				flowId: id,
				title: id,
				description: nil,
				icon: nil,
				color: nil,
				variant: "runner",
				lastRanAt: nil,
				showsResultSheet: false
			)
		})
		return store
	}

	@Test("Home shows The Feed and no flow cards")
	func dashboardShowsFeedOnly() throws {
		let view = makeView(store: DashboardStore())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-feed")
		}
		for retired in [
			"dashboard-mail-card", "dashboard-tasks-card", "dashboard-calendar-card",
			"dashboard-flow-dashboard.todos.summary",
		] {
			#expect(throws: (any Error).self) {
				try view.inspect().find(viewWithAccessibilityIdentifier: retired)
			}
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Continue working")
		}
	}

	@Test("edit mode shows a tray for hidden actions")
	func editModeShowsHiddenActionsTray() throws {
		let prefs = makeAppearance()
		prefs.setDashboardBlockVisible(id: DashboardBlockID("flow.a"), visible: false)
		let view = makeView(store: runnerStore(["flow.a", "flow.b"]), appearance: prefs, isEditing: true)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-tray")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-chip-flow.a")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-unhide-flow.a")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-chip-flow.b")
		}
	}

	@Test("view mode omits the hidden-actions tray")
	func viewModeOmitsHiddenTray() throws {
		let prefs = makeAppearance()
		prefs.setDashboardBlockVisible(id: DashboardBlockID("flow.a"), visible: false)
		let view = makeView(store: runnerStore(["flow.a"]), appearance: prefs, isEditing: false)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-tray")
		}
	}

	@Test("registry splits visible and hidden actions in server order")
	func registrySplitsHiddenActions() {
		let store = runnerStore(["flow.c", "flow.a", "flow.b"])
		let layout = DashboardLayout(hidden: ["flow.a"])
		#expect(
			store.registry.orderedVisibleRunners(layout: layout).map(\.id.rawValue) == ["flow.c", "flow.b"]
		)
		#expect(store.registry.orderedHidden(layout: layout).map(\.id.rawValue) == ["flow.a"])
	}

	@Test("hide onboarding binding stores the preference")
	func hideOnboardingBindingStoresPreference() {
		let prefs = makeAppearance()
		prefs.hideOnboardingBinding.wrappedValue = true
		#expect(prefs.hideOnboarding == true)
	}

	@Test("configure AI provider action opens provider chooser path")
	func configureAIProviderOpensSetupChooser() throws {
		var didOpenAISetup = false
		let incomplete = OnboardingChecklist.make(
			hasConfiguredAIProvider: false,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: true,
			hasSchedule: true,
			hasSkill: true,
			hasRecording: true,
			hasSession: true
		)
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incomplete,
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenSettings: { _ in },
			onOpenAIProviderSetup: { didOpenAISetup = true },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance()
		)
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "onboarding-action-configureAIProvider"
		).button()
		try button.tap()
		#expect(didOpenAISetup == true)
	}

	@Test("connect integrations action opens settings catalog")
	func connectIntegrationsOpensSettingsCatalog() throws {
		var openedNavKey: String?
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: false,
			hasModelConfigured: true,
			hasRequiredPermissions: true,
			hasSchedule: true,
			hasSkill: true,
			hasRecording: true,
			hasSession: true
		)
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: checklist,
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenSettings: { openedNavKey = $0 },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance()
		)
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "onboarding-action-connectIntegrations"
		).button()
		try button.tap()
		#expect(openedNavKey == SettingsItem.integrationsSectionKey)
	}

	@Test("setup persona action opens persona picker")
	func setupPersonaOpensPersonaPicker() throws {
		var didOpenPersonaPicker = false
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: false,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasRecording: false,
			hasSession: false
		)
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: checklist,
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenSettings: { _ in },
			onOpenPersonaPicker: { didOpenPersonaPicker = true },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance()
		)
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "onboarding-action-setupPersona"
		).button()
		try button.tap()
		#expect(didOpenPersonaPicker)
	}

}

@MainActor
@Suite("DashboardFlowBlocks")
struct DashboardFlowBlocksTests {
	private func flowInfo(
		id: String,
		title: String,
		description: String?,
		variant: String,
		icon: String? = nil,
		color: String? = nil,
		showsResultSheet: Bool = false
	) -> FlowDashboardBlockInfo {
		FlowDashboardBlockInfo(
			id: id,
			flowId: id,
			title: title,
			description: description,
			icon: icon,
			color: color,
			variant: variant,
			lastRanAt: nil,
			showsResultSheet: showsResultSheet
		)
	}

	@Test("flow dashboard block info decodes from JSON")
	func flowDashboardBlockInfoDecodes() throws {
		let json = """
		{
			"id": "flow.abc",
			"flowId": "flow.abc",
			"title": "Focus mode",
			"description": "Turn off Wi-Fi",
			"icon": "flame",
			"color": "blue",
			"variant": "runner",
			"lastRanAt": "2026-08-15T12:00:00Z",
			"showsResultSheet": false
		}
		""".data(using: .utf8)!
		let info = try JSONDecoder().decode(FlowDashboardBlockInfo.self, from: json)
		#expect(info.id == "flow.abc")
		#expect(info.isRunner)
		#expect(info.description == "Turn off Wi-Fi")
		#expect(info.icon == "flame")
		#expect(info.color == "blue")
		#expect(info.showsResultSheet == false)
	}

	@Test("flow descriptor carries tile metadata")
	func flowDescriptorCarriesTileMetadata() {
		let runner = DashboardBlockDescriptor.flow(
			flowInfo(
				id: "flow.run",
				title: "Focus mode",
				description: "Turn off Wi-Fi",
				variant: "runner",
				icon: "flame",
				color: "teal"
			),
			sortIndex: 0
		)
		#expect(runner.title == "Focus mode")
		#expect(runner.flowDescription == "Turn off Wi-Fi")
		#expect(runner.accessibilityIdentifier == "dashboard-flow-flow.run")
		#expect(runner.systemImage == "flame")
		#expect(runner.flowColor == "teal")

		let plain = DashboardBlockDescriptor.flow(
			flowInfo(id: "flow.plain", title: "Plain", description: nil, variant: "runner"),
			sortIndex: 1
		)
		#expect(plain.systemImage == "play.circle")
	}

	@Test("registry keeps only runner flows and replaces them on sync")
	func registrySyncsRunners() {
		let registry = DashboardBlockRegistry()
		#expect(registry.blocks.isEmpty)
		registry.syncFlowBlocks([
			flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
			flowInfo(id: "flow.info", title: "Old card", description: nil, variant: "informational"),
		])
		#expect(registry.blocks.map(\.id.rawValue) == ["flow.run"])
		let first = registry.block(rawId: "flow.run")
		registry.syncFlowBlocks([
			flowInfo(id: "flow.run", title: "Renamed", description: nil, variant: "runner"),
		])
		#expect(registry.block(rawId: "flow.run") === first)
		#expect(registry.block(rawId: "flow.run")?.title == "Renamed")

		registry.syncFlowBlocks([])
		#expect(registry.blocks.isEmpty)
	}

	@Test("dashboard card shows intelligence outline while updating")
	func dashboardCardShowsIntelligenceOutlineWhileUpdating() throws {
		let card = DashboardCard(isUpdating: true) { Text("Body") }
		#expect(throws: Never.self) {
			_ = try card.inspect().find(viewWithAccessibilityIdentifier: "dashboard-card-intelligence-outline")
		}
	}

	@Test("idle dashboard card does not show intelligence outline")
	func idleDashboardCardHidesIntelligenceOutline() throws {
		let card = DashboardCard { Text("Body") }
		#expect(throws: (any Error).self) {
			_ = try card.inspect().find(viewWithAccessibilityIdentifier: "dashboard-card-intelligence-outline")
		}
	}

	@Test("runner row is a colored tile with the flow symbol and title")
	func runnerRowShowsIconAsAction() throws {
		let block = CategoryDashboardBlock(
			descriptor: .flow(
				flowInfo(
					id: "flow.run",
					title: "Focus mode",
					description: "Turn off Wi-Fi",
					variant: "runner",
					icon: "flame",
					color: "teal"
				),
				sortIndex: 100
			)
		)
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.runner.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let row = DashboardActionRunnerRow(block: block, appearancePreferences: prefs)
		#expect(DashboardActionRunnerRow.helpHoverDelay == 1.0)
		#expect(DashboardBlockLayout.actionTileWidth == 100)
		#expect(DashboardBlockLayout.actionTileHeight == 68)
		#expect(throws: Never.self) {
			try row.inspect().find(viewWithAccessibilityIdentifier: "dashboard-flow-run-flow.run")
		}
		let names = try row.inspect().findAll(ViewType.Image.self).compactMap { try? $0.actualImage().name() }
		#expect(names.contains("flame"))
		#expect(names.contains("play.circle"))
		#expect(throws: Never.self) {
			try row.inspect().find(text: "Focus mode")
		}
		#expect(throws: (any Error).self) {
			try row.inspect().find(text: "Run Now")
		}
		#expect(throws: (any Error).self) {
			try row.inspect().find(text: "Turn off Wi-Fi")
		}
	}

	@Test("actions rail hosts runner tiles")
	func actionsRailHostsRunners() throws {
		let store = DashboardStore()
		store.registry.syncFlowBlocks([
			flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
		])
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.flow.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(hideOnboarding: true, defaults: suite)
		#expect(store.registry.orderedVisibleRunners(layout: prefs.dashboardLayout).map(\.id.rawValue)
			== ["flow.run"])

		let runnerBlock = store.registry.block(rawId: "flow.run")!
		let rail = DashboardActionRunnersRail(blocks: [runnerBlock]) { block in
			DashboardActionRunnerRow(block: block, appearancePreferences: prefs)
		}
		#expect(throws: Never.self) {
			try rail.inspect().find(viewWithAccessibilityIdentifier: "dashboard-actions-rail")
		}
		#expect(throws: Never.self) {
			try rail.inspect().find(text: "Actions")
		}
		#expect(throws: Never.self) {
			try rail.inspect().find(viewWithAccessibilityIdentifier: "dashboard-flow-run-flow.run")
		}
		#expect(throws: Never.self) {
			try rail.inspect().find(text: "Focus mode")
		}
	}

	@Test("actions rail is omitted when there are no visible runners")
	func actionsRailOmittedWithoutRunners() throws {
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.rail.none.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(
			hideOnboarding: true,
			defaults: suite
		)
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: OnboardingChecklist.make(
				hasConfiguredAIProvider: true,
				hasConnectedIntegrations: true,
				hasModelConfigured: true,
				hasRequiredPermissions: true,
				hasSchedule: true,
				hasSkill: true,
				hasRecording: true,
				hasSession: true
			),
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: prefs
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-actions-rail")
		}
	}

	@Test("toolbar pane flag hides the actions rail while keeping runners registered")
	func actionsPaneToggleHidesRail() throws {
		let store = DashboardStore()
		store.registry.syncFlowBlocks([
			flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
		])
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.rail.toggle.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(
			hideOnboarding: true,
			defaults: suite
		)
		prefs.dashboardLayout = DashboardLayout(hidden: [], actionsVisible: false)
		let view = DashboardView(
			store: store,
			userName: "Karim",
			onboarding: OnboardingChecklist.make(
				hasConfiguredAIProvider: true,
				hasConnectedIntegrations: true,
				hasModelConfigured: true,
				hasRequiredPermissions: true,
				hasSchedule: true,
				hasSkill: true,
				hasRecording: true,
				hasSession: true
			),
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: prefs
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-actions-rail")
		}
		#expect(store.registry.block(rawId: "flow.run") != nil)
	}

	@Test("hiding the last runner removes the actions rail")
	func hidingLastRunnerRemovesRail() throws {
		let store = DashboardStore()
		store.registry.syncFlowBlocks([
			flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
		])
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.rail.hide.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(
			hideOnboarding: true,
			defaults: suite
		)
		prefs.dashboardLayout = DashboardLayout(hidden: ["flow.run"])
		let view = DashboardView(
			store: store,
			userName: "Karim",
			onboarding: OnboardingChecklist.make(
				hasConfiguredAIProvider: true,
				hasConnectedIntegrations: true,
				hasModelConfigured: true,
				hasRequiredPermissions: true,
				hasSchedule: true,
				hasSkill: true,
				hasRecording: true,
				hasSession: true
			),
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: prefs,
			isEditing: true
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-actions-rail")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-chip-flow.run")
		}
	}
}
