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
			"tasks": null
		}
		""".data(using: .utf8)!
		let data = try JSONDecoder().decode(DashboardData.self, from: json)
		#expect(data.email?.count == 95)
		#expect(data.email?.groups.first?.label == "Urgent")
		#expect(data.email?.items.first?.subtitle == "Mollye Miller")
		#expect(data.tasks == nil)
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
		#expect(ai?.subtitle == "Pick the model that powers Toby")
		#expect(ai?.systemImage == "cpu")
		#expect(ai?.isComplete == true)
		#expect(ai?.actionLabel == "Configure")
		let integrations = checklist.steps.first { $0.kind == .connectIntegrations }
		#expect(integrations?.systemImage == DetailRoute.integrations.systemImage)
		let skills = checklist.steps.first { $0.kind == .createSkill }
		#expect(skills?.systemImage == DetailRoute.skills.systemImage)
	}

	@Test("due text falls back to no due date")
	func dueTextNoDueDate() {
		#expect(DashboardFormat.dueText(nil).text == "No due date")
	}

	@Test("dashboard store initializes empty")
	func dashboardStoreInitializesEmpty() {
		let store = DashboardStore()
		#expect(store.email == nil)
		#expect(store.tasks == nil)
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
}

@MainActor
@Suite("DashboardView")
struct DashboardViewTests {
	private func makeView(store: DashboardStore) -> DashboardView {
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
			onStartChat: {},
			onSummarizeEmail: {}
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
			try card.inspect().find(text: "Pick the model that powers Toby")
		}
	}
}

@MainActor
@Suite("DashboardSummary")
struct DashboardSummaryTests {
	@Test("DashboardCategoryAiSummary decodes from JSON")
	func aiSummaryDecodes() throws {
		let json = """
		{
			"category": "email",
			"text": "You have 3 urgent emails from your manager.",
			"generatedAt": "2026-07-10T12:00:00Z",
			"personaName": "Toby",
			"count": 95,
			"launchUrls": ["https://mail.example.com"]
		}
		""".data(using: .utf8)!
		let summary = try JSONDecoder().decode(DashboardCategoryAiSummary.self, from: json)
		#expect(summary.category == "email")
		#expect(summary.text == "You have 3 urgent emails from your manager.")
		#expect(summary.personaName == "Toby")
		#expect(summary.count == 95)
		#expect(summary.launchUrls?.first == "https://mail.example.com")
	}

	@Test("DashboardCategoryAiSummary decodes with null launchUrls")
	func aiSummaryDecodesWithNullLaunchUrls() throws {
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
		let summary = try JSONDecoder().decode(DashboardCategoryAiSummary.self, from: json)
		#expect(summary.category == "tasks")
		#expect(summary.launchUrls == nil)
	}

	@Test("dashboard store initializes with empty summary state")
	func dashboardStoreSummaryInitial() {
		let store = DashboardStore()
		#expect(store.emailSummary == nil)
		#expect(store.tasksSummary == nil)
		#expect(store.emailSummaryLoading == false)
		#expect(store.tasksSummaryLoading == false)
		#expect(store.isSummaryLoading == false)
		#expect(store.summariesAreStale == true)
		#expect(store.lastSummaryLoadedAt == nil)
	}
}

