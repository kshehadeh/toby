import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("RootView")
struct RootViewTests {
	private func makeRootView() -> RootView {
		RootView(
			store: ChatStore(),
			dashboardStore: DashboardStore(),
			configureStore: ConfigureStore(),
			recordingsStore: RecordingsStore(),
			schedulesStore: SchedulesStore(),
			projectsStore: ProjectsStore(),
			integrationsStore: ConfigureStore(),
			skillsStore: SkillsStore(),
			memoriesStore: MemoriesStore(),
			flowsStore: FlowsStore(),
			personaEditorCoordinator: PersonaEditorCoordinator(),
			updateStore: UpdateStore(),
			changelogStore: ChangelogStore(),
			pluginsStore: PluginsStore()
		)
	}

	@Test("root view presents app sidebar")
	func rootViewPresentsAppSidebar() throws {
		let view = makeRootView()
			.environment(AppearancePreferences.shared)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "app-sidebar")
		}
	}

	@Test("new chat targets the selected project only from the Projects route")
	func newChatTargetsSelectedProject() {
		#expect(shouldCreateProjectChat(currentRoute: .projects, selectedProjectId: "proj-1"))
		#expect(!shouldCreateProjectChat(currentRoute: .projects, selectedProjectId: nil))
		#expect(!shouldCreateProjectChat(currentRoute: .chat, selectedProjectId: "proj-1"))
	}

	@Test("main chat leaves a project session once it is idle")
	func mainChatLeavesIdleProjectSession() {
		#expect(
			shouldLeaveProjectSessionForMainChat(
				currentRoute: .chat,
				sessionProjectId: "proj-1",
				isLoading: false,
			)
		)
		#expect(
			!shouldLeaveProjectSessionForMainChat(
				currentRoute: .chat,
				sessionProjectId: "proj-1",
				isLoading: true,
			)
		)
		#expect(
			!shouldLeaveProjectSessionForMainChat(
				currentRoute: .projects,
				sessionProjectId: "proj-1",
				isLoading: false,
			)
		)
		#expect(
			!shouldLeaveProjectSessionForMainChat(
				currentRoute: .chat,
				sessionProjectId: nil,
				isLoading: false,
			)
		)
		#expect(
			!shouldLeaveProjectSessionForMainChat(
				currentRoute: .chat,
				sessionProjectId: "  ",
				isLoading: false,
			)
		)
	}

}
