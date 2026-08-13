import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("NewChatPersonaMenu")
struct NewChatPersonaMenuTests {
	@Test("default menu title is Chat with Default Persona")
	func defaultMenuTitle() {
		#expect(NewChatPersonaMenuItem.defaultTitle == "Chat with Default Persona")
	}

	@Test("named menu title uses persona label")
	func namedMenuTitleUsesLabel() {
		let persona = PersonaOption(
			name: "mailman",
			label: "Mailman",
			imagePath: nil,
			imageUrl: nil,
			isDefault: false,
			isBuiltIn: true,
		)
		#expect(NewChatPersonaMenuItem.title(for: persona) == "Chat with Mailman")
	}

	@Test("menu exposes default and named persona actions")
	func menuExposesPersonaActions() throws {
		var selectedName: String?
		let view = NewChatPersonaMenu(
			personas: [
				PersonaOption(
					name: "Toby",
					label: "Toby",
					imagePath: nil,
					imageUrl: nil,
					isDefault: true,
					isBuiltIn: true,
				),
				PersonaOption(
					name: "Mailman",
					label: "Mailman",
					imagePath: nil,
					imageUrl: nil,
					isDefault: false,
					isBuiltIn: true,
				),
			],
			isDisabled: false,
			onSelect: { selectedName = $0?.name },
		)

		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "new-chat-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat with Default Persona")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat with Toby")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat with Mailman")
		}

		let mailman = try view.inspect().find(
			viewWithAccessibilityIdentifier: "new-chat-persona-Mailman",
		).button()
		try mailman.tap()
		#expect(selectedName == "Mailman")
	}

	@Test("default menu item starts a chat without pinning a persona")
	func defaultMenuItemSelectsNilPersona() throws {
		var selectedName: String? = "placeholder"
		let view = NewChatPersonaMenu(
			personas: [],
			isDisabled: false,
			onSelect: { selectedName = $0?.name },
		)
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "new-chat-persona-default",
		).button()
		try button.tap()
		#expect(selectedName == nil)
	}
}
