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
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "app-sidebar")
		}
	}

}
