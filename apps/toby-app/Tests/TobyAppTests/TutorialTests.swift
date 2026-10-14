import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("Section tutorials")
struct TutorialTests {
	private func withDefaults(_ body: (UserDefaults) throws -> Void) rethrows {
		let name = "TutorialTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: name)!
		defer { defaults.removePersistentDomain(forName: name) }
		try body(defaults)
	}

	@Test("Tutorials start only when requested; progress persists independently")
	func persistence() {
		withDefaults { defaults in
			let store = TutorialStore(defaults: defaults)
			#expect(store.showTutorialButton)
			#expect(store.currentStep == nil)
			store.start(.home)
			store.advance(.home)
			store.advance(.projects)
			store.start(.projects)
			#expect(store.currentStep == .projects)
			store.advance(.projects)
			#expect(store.currentStep == nil)
			let relaunched = TutorialStore(defaults: defaults)
			#expect(relaunched.currentStep == nil)
			#expect(relaunched.completedBySection["home"] == ["home", "projects"])
			#expect(relaunched.completedBySection["projects"] == ["projects"])
		}
	}

	@Test("Replay resets only the chosen section and refreshes TipKit identity")
	func replay() {
		withDefaults { defaults in
			let store = TutorialStore(defaults: defaults)
			store.start(.projects)
			store.advance(.projects)
			store.start(.flows)
			store.advance(.flows)
			let generation = store.generation
			store.start(.flows)
			#expect(store.currentStep == .flows)
			#expect(store.completedBySection["flows"] == [])
			#expect(store.completedBySection["projects"] == ["projects"])
			#expect(store.generation > generation)
		}
	}

	@Test("Hiding the button changes only visibility, not tutorial progress")
	func visibility() {
		withDefaults { defaults in
			let store = TutorialStore(defaults: defaults)
			store.start(.flows)
			store.advance(.flows)
			store.showTutorialButton = false
			#expect(store.currentStep == .builtInFlow)
			#expect(!TutorialStore(defaults: defaults).showTutorialButton)
			store.showTutorialButton = true
			#expect(store.currentStep == .builtInFlow)
		}
	}

	@Test("Closing a tip stops only its session and leaves the button visible")
	func dismissal() {
		withDefaults { defaults in
			let store = TutorialStore(defaults: defaults)
			store.start(.flows)
			store.advance(.flows)
			store.stop(ifCurrent: .builtInFlow, generation: store.generation)
			#expect(store.currentStep == nil)
			#expect(store.showTutorialButton)
			#expect(store.completedBySection["flows"] == ["flows"])
		}
	}

	@Test("Stale callbacks cannot stop a replayed or different section")
	func staleDismissal() {
		withDefaults { defaults in
			let store = TutorialStore(defaults: defaults)
			store.start(.projects)
			let generation = store.generation
			store.start(.projects)
			store.stop(ifCurrent: .projects, generation: generation)
			#expect(store.currentStep == .projects)
			store.start(.library)
			store.advance(.projects)
			store.stop(ifCurrent: .projects, generation: store.generation)
			#expect(store.currentStep == .library)
		}
	}

	@Test("Navigation ends the previous session without crossing section boundaries")
	func navigation() {
		withDefaults { defaults in
			let store = TutorialStore(defaults: defaults)
			store.start(.home)
			store.setContext(.home)
			#expect(store.currentStep == .home)
			store.setContext(.flows)
			#expect(store.currentStep == nil)
			store.start(.flows)
			for step in TutorialSection.flows.steps { store.advance(step) }
			#expect(store.currentStep == nil)
			#expect(store.completedBySection["home"] == [])
		}
	}

	@Test("Every main route maps to its own tutorial", arguments: DetailRoute.allCases)
	func routes(_ route: DetailRoute) {
		let section = TutorialSection.forRoute(route)
		#expect(section.title == route.menuTitle)
		#expect(!section.steps.isEmpty)
		#expect(Set(section.steps).count == section.steps.count)
	}

	@Test("Toolbar action names and invokes the current section tutorial")
	func toolbarAction() throws {
		var didStart = false
		let view = TutorialToolbarButton(section: .flows) { didStart = true }
		let button = try view.inspect().find(ViewType.Button.self)
		try button.tap()
		#expect(didStart)
	}
}
