import SwiftUI

/// Titles for the chat-toolbar new-chat persona menu.
enum NewChatPersonaMenuItem {
	static let defaultTitle = "Chat with Default Persona"

	static func title(for persona: PersonaOption) -> String {
		"Chat with \(persona.label)"
	}
}

/// Plus control in the chat toolbar: click starts a default chat; the menu
/// lists each persona so a new session can pin one at creation time.
struct NewChatPersonaMenu: View {
	let personas: [PersonaOption]
	let isDisabled: Bool
	let onSelect: (PersonaOption?) -> Void

	var body: some View {
		// `primaryAction` menus snapshot items when the control is created.
		// Identity must change when the persona list arrives so macOS rebuilds
		// the dropdown instead of keeping the first (often empty) snapshot.
		Menu {
			Button(NewChatPersonaMenuItem.defaultTitle) {
				onSelect(nil)
			}
			.accessibilityIdentifier("new-chat-persona-default")

			Divider()

			ForEach(personas) { persona in
				Button(NewChatPersonaMenuItem.title(for: persona)) {
					onSelect(persona)
				}
				.accessibilityIdentifier("new-chat-persona-\(persona.name)")
			}
		} label: {
			Image(systemName: "plus")
		} primaryAction: {
			onSelect(nil)
		}
		.id(menuIdentity)
		.help("New Chat")
		.disabled(isDisabled)
		.accessibilityIdentifier("new-chat-button")
		.accessibilityLabel("New Chat")
	}

	private var menuIdentity: String {
		personas.map(\.name).joined(separator: "\u{1e}")
	}
}
