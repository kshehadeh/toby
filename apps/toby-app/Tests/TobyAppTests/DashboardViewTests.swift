import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("DashboardModels")
struct DashboardModelsTests {
	@Test("dashboard data decodes from JSON")
	func dashboardDataDecodes() throws {
		let json = """
		{
			"email": {
				"count": 95,
				"sources": [{
					"providerName": "email",
					"providerDisplayName": "Email (IMAP/SMTP)",
					"iconUrl": null,
					"summary": {
						"count": 95,
						"groups": [{ "id": "email:urgent", "label": "Urgent", "count": 4 }],
						"items": [{ "id": "m1", "title": "Invitation", "subtitle": "Mollye Miller", "timestamp": "2026-07-01T00:00:00Z", "urgency": "high" }],
						"generatedAt": "2026-07-05T09:00:00Z"
					}
				}],
				"items": [{ "id": "m1", "title": "Invitation", "subtitle": "Mollye Miller", "timestamp": "2026-07-01T00:00:00Z", "urgency": "high" }],
				"groups": [{ "id": "email:urgent", "label": "Urgent", "count": 4 }],
				"generatedAt": "2026-07-05T09:00:00Z"
			},
			"tasks": null,
			"calendar": {
				"count": 2,
				"sources": [{
					"providerName": "applecalendar",
					"providerDisplayName": "Apple Calendar",
					"iconUrl": null,
					"summary": {
						"count": 2,
						"groups": [{ "id": "Work", "label": "Work", "count": 2 }],
						"items": [{ "id": "e1", "title": "Standup", "subtitle": "Work", "timestamp": "2026-07-17T14:00:00Z", "urgency": "normal" }],
						"generatedAt": "2026-07-17T10:00:00Z"
					}
				}],
				"items": [{ "id": "e1", "title": "Standup", "subtitle": "Work", "timestamp": "2026-07-17T14:00:00Z", "urgency": "normal" }],
				"groups": [{ "id": "applecalendar:Work", "label": "Work", "count": 2 }],
				"generatedAt": "2026-07-17T10:00:00Z"
			}
		}
		""".data(using: .utf8)!
		let data = try JSONDecoder().decode(DashboardData.self, from: json)
		#expect(data.email?.count == 95)
		#expect(data.email?.groups.first?.label == "Urgent")
		#expect(data.email?.items.first?.subtitle == "Mollye Miller")
		#expect(data.tasks == nil)
		#expect(data.calendar?.count == 2)
		#expect(data.calendar?.items.first?.title == "Standup")
	}

	@Test("onboarding checklist counts completed steps")
	func onboardingChecklistCounts() {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasTranscriptionConfigured: false,
			hasRecording: false,
			hasSession: false
		)
		#expect(checklist.completedCount == 3)
		#expect(checklist.totalCount == 9)
		#expect(checklist.isComplete == false)
		#expect(checklist.progress == 3.0 / 9.0)
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
			hasTranscriptionConfigured: true,
			hasRecording: true,
			hasSession: true
		)
		#expect(checklist.isComplete)
		#expect(checklist.completedCount == 9)
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
			hasTranscriptionConfigured: false,
			hasRecording: false,
			hasSession: false
		)
		#expect(checklist.upNextKind == .connectIntegrations)
		let ai = checklist.steps.first { $0.kind == .configureAIProvider }
		#expect(ai?.subtitle == "Connect Vercel or OpenRouter (guided)")
		#expect(ai?.systemImage == "cpu")
		#expect(ai?.isComplete == true)
		#expect(ai?.actionLabel == "Connect")
		let integrations = checklist.steps.first { $0.kind == .connectIntegrations }
		#expect(integrations?.systemImage == DetailRoute.integrations.systemImage)
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
		#expect(store.email == nil)
		#expect(store.tasks == nil)
		#expect(store.calendar == nil)
		#expect(store.isLoading == false)
		#expect(store.hasLoadedOnce == false)
		#expect(store.lastLoadedAt == nil)
	}
}

@MainActor
@Suite("DashboardNavigation")
struct DashboardNavigationTests {
	@Test("detail route includes dashboard case")
	func detailRouteIncludesDashboard() {
		#expect(DetailRoute.allCases.contains(.dashboard))
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
	private func makeAppearance(
		hideOnboarding: Bool = false,
		showDashboardEmail: Bool = true,
		showDashboardTasks: Bool = true,
		showDashboardCalendar: Bool = true
	) -> AppearancePreferences {
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.\(UUID().uuidString)")!
		return AppearancePreferences(
			hideOnboarding: hideOnboarding,
			showDashboardEmail: showDashboardEmail,
			showDashboardTasks: showDashboardTasks,
			showDashboardCalendar: showDashboardCalendar,
			defaults: suite
		)
	}

	private func incompleteChecklist() -> OnboardingChecklist {
		OnboardingChecklist.make(
			hasConfiguredAIProvider: false,
			hasConnectedIntegrations: false,
			hasModelConfigured: false,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasTranscriptionConfigured: false,
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
				hasTranscriptionConfigured: false,
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

	@Test("onboarding card renders title")
	func onboardingCardRendersTitle() throws {
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: false,
			hasSchedule: false,
			hasSkill: false,
			hasTranscriptionConfigured: false,
			hasRecording: false,
			hasSession: false
		)
		let card = OnboardingCard(checklist: checklist, onStepAction: { _ in })
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Finish setting up Toby")
		}
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
			hasTranscriptionConfigured: false,
			hasRecording: false,
			hasSession: false
		)
		let card = OnboardingCard(checklist: checklist, onStepAction: { _ in })
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
			try card.inspect().find(text: "Connect Vercel or OpenRouter (guided)")
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

	@Test("dashboard shows mail, tasks, and calendar cards by default")
	func dashboardShowsMailAndTasksByDefault() throws {
		let view = makeView(store: DashboardStore())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-tasks-card")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-calendar-card")
		}
	}

	@Test("dashboard hides mail card when show preference is off")
	func dashboardHidesMailCardWhenPreferenceOff() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance(showDashboardEmail: false)
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-tasks-card")
		}
	}

	@Test("dashboard hides tasks card when show preference is off")
	func dashboardHidesTasksCardWhenPreferenceOff() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance(showDashboardTasks: false)
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-tasks-card")
		}
	}

	@Test("dashboard hides both cards when both show preferences are off")
	func dashboardHidesBothCardsWhenPreferencesOff() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance(
				showDashboardEmail: false,
				showDashboardTasks: false,
				showDashboardCalendar: false
			)
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-tasks-card")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-calendar-card")
		}
	}

	@Test("dashboard hides calendar card when show preference is off")
	func dashboardHidesCalendarCardWhenPreferenceOff() throws {
		let view = DashboardView(
			store: DashboardStore(),
			userName: "Karim",
			onboarding: incompleteChecklist(),
			isOnboardingReady: true,
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance(showDashboardCalendar: false)
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-calendar-card")
		}
	}

	@Test("edit mode shows a tray for hidden cards and keeps remaining cards")
	func editModeShowsHiddenTray() throws {
		let prefs = makeAppearance(showDashboardEmail: false)
		let view = makeView(store: DashboardStore(), appearance: prefs, isEditing: true)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-tasks-card")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-tray")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-chip-email")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-unhide-email")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-edit-overlay-tasks")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-reorder-tasks")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hide-tasks")
		}
	}

	@Test("view mode omits the hidden-card tray")
	func viewModeOmitsHiddenTray() throws {
		let prefs = makeAppearance(showDashboardEmail: false)
		let view = makeView(store: DashboardStore(), appearance: prefs, isEditing: false)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hidden-tray")
		}
	}

	@Test("custom layout order is applied by the registry")
	func registryAppliesCustomOrder() {
		let store = DashboardStore()
		let layout = DashboardLayout(order: ["calendar", "email", "tasks"], hidden: ["tasks"])
		#expect(
			store.registry.orderedVisible(layout: layout).map(\.id.rawValue) == ["calendar", "email"]
		)
		#expect(store.registry.orderedHidden(layout: layout).map(\.id.rawValue) == ["tasks"])
	}

	@Test("dashboard block visibility binding toggles preference under animation path")
	func dashboardBlockVisibilityBindingTogglesPreference() {
		let prefs = makeAppearance()
		let emailBinding = prefs.dashboardBlockVisibilityBinding(.email)
		emailBinding.wrappedValue = false
		#expect(prefs.showDashboardEmail == false)
		emailBinding.wrappedValue = true
		#expect(prefs.showDashboardEmail == true)

		let tasksBinding = prefs.dashboardBlockVisibilityBinding(.tasks)
		tasksBinding.wrappedValue = false
		#expect(prefs.showDashboardTasks == false)

		let hideBinding = prefs.hideOnboardingBinding
		hideBinding.wrappedValue = true
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
			hasTranscriptionConfigured: true,
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
			hasTranscriptionConfigured: false,
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

	@Test("setup transcription action opens settings on transcription section")
	func setupTranscriptionOpensTranscriptionSettings() throws {
		var openedNavKey: String?
		// Complete earlier steps so transcription is "up next" and shows its action.
		let checklist = OnboardingChecklist.make(
			hasConfiguredAIProvider: true,
			hasConnectedIntegrations: true,
			hasModelConfigured: true,
			hasRequiredPermissions: true,
			hasSchedule: true,
			hasSkill: true,
			hasTranscriptionConfigured: false,
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
			onOpenSettings: { openedNavKey = $0 },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: makeAppearance()
		)
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "onboarding-action-setupTranscription"
		).button()
		try button.tap()
		#expect(openedNavKey == "transcription")
	}
}

@MainActor
@Suite("DashboardBlockContent")
struct DashboardBlockContentTests {
	@Test("DashboardBlockContent decodes from JSON")
	func contentDecodes() throws {
		let json = """
		{
			"category": "email",
			"text": "You have 3 urgent emails from your manager.",
			"generatedAt": "2026-07-10T12:00:00Z",
			"personaName": "Toby",
			"count": 95,
			"launchUrls": ["https://mail.example.com"],
			"sources": [
				{
					"providerName": "email",
					"providerDisplayName": "Email (IMAP/SMTP)",
					"launchUrl": "https://mail.example.com"
				}
			]
		}
		""".data(using: .utf8)!
		let content = try JSONDecoder().decode(DashboardBlockContent.self, from: json)
		#expect(content.category == "email")
		#expect(content.text == "You have 3 urgent emails from your manager.")
		#expect(content.personaName == "Toby")
		#expect(content.count == 95)
		#expect(content.launchUrls?.first == "https://mail.example.com")
		#expect(content.sources?.first?.providerName == "email")
		#expect(content.hasBody)
	}

	@Test("DashboardBlockContent decodes with null launchUrls")
	func contentDecodesWithNullLaunchUrls() throws {
		let json = """
		{
			"category": "tasks",
			"text": "You have 2 overdue tasks.",
			"generatedAt": "2026-07-10T12:00:00Z",
			"personaName": "Work",
			"count": 5,
			"launchUrls": null
		}
		""".data(using: .utf8)!
		let content = try JSONDecoder().decode(DashboardBlockContent.self, from: json)
		#expect(content.category == "tasks")
		#expect(content.launchUrls == nil)
	}

	@Test("dashboard store initializes with empty content state")
	func dashboardStoreContentInitial() {
		let store = DashboardStore()
		#expect(store.emailContent == nil)
		#expect(store.tasksContent == nil)
		#expect(store.calendarContent == nil)
		#expect(store.emailSummaryLoading == false)
		#expect(store.tasksSummaryLoading == false)
		#expect(store.calendarSummaryLoading == false)
		#expect(store.isSummaryLoading == false)
		#expect(store.lastLoadedAt == nil)
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
		showsResultSheet: Bool = false
	) -> FlowDashboardBlockInfo {
		FlowDashboardBlockInfo(
			id: id,
			flowId: id,
			title: title,
			description: description,
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
			"variant": "runner",
			"lastRanAt": "2026-08-15T12:00:00Z",
			"showsResultSheet": false
		}
		""".data(using: .utf8)!
		let info = try JSONDecoder().decode(FlowDashboardBlockInfo.self, from: json)
		#expect(info.id == "flow.abc")
		#expect(info.isRunner)
		#expect(info.description == "Turn off Wi-Fi")
		#expect(info.showsResultSheet == false)
	}

	@Test("flow descriptor marks runner vs informational")
	func flowDescriptorMarksVariants() {
		let runner = DashboardBlockDescriptor.flow(
			flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
			sortIndex: 100
		)
		#expect(runner.isFlowBlock)
		#expect(runner.isFlowRunner)
		#expect(runner.title == "Focus mode")
		#expect(runner.flowDescription == "Turn off Wi-Fi")
		#expect(runner.accessibilityIdentifier == "dashboard-flow-flow.run")

		let info = DashboardBlockDescriptor.flow(
			flowInfo(id: "flow.info", title: "Status", description: "Latest", variant: "informational"),
			sortIndex: 101
		)
		#expect(info.isFlowBlock)
		#expect(!info.isFlowRunner)
	}

	@Test("registry syncs flow cards without dropping built-ins")
	func registrySyncsFlowCards() {
		let registry = DashboardBlockRegistry()
		#expect(registry.blocks.contains { $0.id == .email })
		registry.syncFlowBlocks(
			[
				flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
			],
			client: TobyClient()
		)
		#expect(registry.blocks.contains { $0.id == .email })
		#expect(registry.blocks.contains { $0.id.rawValue == "flow.run" })
		#expect(registry.block(rawId: "flow.run")?.descriptor.isFlowRunner == true)

		registry.syncFlowBlocks([], client: TobyClient())
		#expect(!registry.blocks.contains { $0.descriptor.isFlowBlock })
		#expect(registry.blocks.contains { $0.id == .email })
	}

	@Test("flow informational actions include open flow")
	func flowInformationalActionsIncludeOpenFlow() {
		let block = CategoryDashboardBlock(
			descriptor: .flow(
				flowInfo(id: "flow.info", title: "Status", description: "Latest", variant: "informational"),
				sortIndex: 100
			)
		)
		let actions = block.actions(context: .init())
		#expect(actions.map(\.id).contains("open-flow"))
		#expect(!actions.map(\.id).contains("summarize-email"))
	}

	@Test("built-in block card renders definition title")
	func builtInBlockCardRendersTitle() throws {
		let block = CategoryDashboardBlock(descriptor: .email)
		let card = DashboardBlockCard(block: block)
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Unread mail")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(viewWithAccessibilityIdentifier: "dashboard-mail-card")
		}
	}

	@Test("runner card shows description and run now")
	func runnerCardShowsDescriptionAndRunNow() throws {
		let block = CategoryDashboardBlock(
			descriptor: .flow(
				flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
				sortIndex: 100
			)
		)
		let card = FlowRunnerDashboardCard(block: block)
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Focus mode")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Turn off Wi-Fi")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Run Now")
		}
		#expect(throws: Never.self) {
			try card.inspect().find(viewWithAccessibilityIdentifier: "dashboard-flow-run-flow.run")
		}
	}

	@Test("dashboard view renders informational and runner flow cards")
	func dashboardViewRendersFlowCards() throws {
		let store = DashboardStore()
		store.registry.syncFlowBlocks(
			[
				flowInfo(id: "flow.info", title: "Inbox note", description: "Latest status", variant: "informational"),
				flowInfo(id: "flow.run", title: "Focus mode", description: "Turn off Wi-Fi", variant: "runner"),
			],
			client: TobyClient()
		)
		let suite = UserDefaults(suiteName: "toby.tests.dashboard.flow.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(
			hideOnboarding: true,
			defaults: suite
		)
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
				hasTranscriptionConfigured: true,
				hasRecording: true,
				hasSession: true
			),
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			actionContext: .init(startChat: {}),
			appearancePreferences: prefs
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-flow-flow.info")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-flow-flow.run")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Run Now")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Turn off Wi-Fi")
		}
	}
}


