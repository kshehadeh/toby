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
			hasRecording: false,
			hasSession: false
		)
		#expect(checklist.completedCount == 3)
		#expect(checklist.totalCount == 8)
		#expect(checklist.isComplete == false)
		#expect(checklist.progress == 0.375)
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
				hasRecording: false,
				hasSession: false
			),
			onRefresh: {},
			onSelectRoute: { _ in },
			onOpenPermissions: {},
			onStartChat: {},
			onSummarizeEmail: {},
			metrics: []
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

	@Test("dashboard view renders metric counts")
	func dashboardViewRendersMetricCounts() throws {
		let metrics = [
			DashboardMetric(route: .recordings, count: 7, label: "Recordings", systemImage: "waveform"),
			DashboardMetric(route: .skills, count: 3, label: "Skills", systemImage: "wand.and.stars"),
		]
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
			onStartChat: {},
			onSummarizeEmail: {},
			metrics: metrics
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "7")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Recordings")
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
			hasRecording: false,
			hasSession: false
		)
		let card = OnboardingCard(checklist: checklist, onStepAction: { _ in })
		#expect(throws: Never.self) {
			try card.inspect().find(text: "Finish setting up Toby")
		}
	}
}
