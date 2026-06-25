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
			configureStore: ConfigureStore(),
			recordingsStore: RecordingsStore(),
			schedulesStore: SchedulesStore(),
			integrationsStore: ConfigureStore(),
			skillsStore: SkillsStore(),
			personaEditorCoordinator: PersonaEditorCoordinator()
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
