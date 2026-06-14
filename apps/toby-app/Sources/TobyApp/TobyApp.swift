import SwiftUI

@main
struct TobyApp: App {
	@State private var store = ChatStore()

	var body: some Scene {
		WindowGroup {
			RootView(store: store)
				.frame(minWidth: 860, minHeight: 560)
		}
		.windowStyle(.automatic)
		.defaultSize(width: 1024, height: 720)
		.commands {
			CommandGroup(after: .sidebar) {
				Button("Search Sessions…") {
					NotificationCenter.default.post(name: .openCommandPalette, object: nil)
				}
				.keyboardShortcut("k", modifiers: .command)
			}
		}
	}
}
