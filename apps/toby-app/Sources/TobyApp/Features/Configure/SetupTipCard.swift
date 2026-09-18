import AppKit
import SwiftUI
import TipKit

/// Inline help card using TipKit’s macOS tip chrome (icon, title, message,
/// close, optional Learn More). Presentation is view-local (`isPresented`) so
/// settings copy is not stored in TipKit’s dismiss datastore.
struct SetupTipCard: View {
	var tipId: String
	var title: String
	var message: String? = nil
	var actionTitle: String? = nil
	var actionURL: URL? = nil
	var accessibilityId: String = "setup-tip-card"

	@State private var isPresented = true

	var body: some View {
		TipView(tip, isPresented: $isPresented, arrowEdge: nil) { action in
			if action.id == "learn-more", let actionURL {
				NSWorkspace.shared.open(actionURL)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
		.listRowBackground(Color.clear)
		.listRowSeparator(.hidden)
		.accessibilityIdentifier(accessibilityId)
		.task {
			TobyTips.configure()
		}
	}

	private var tip: SetupHelpTip {
		SetupHelpTip(
			id: tipId,
			titleText: title,
			messageText: message,
			actionTitle: actionURL == nil ? nil : actionTitle
		)
	}
}

struct SetupHelpTip: Tip {
	let id: String
	let titleText: String
	let messageText: String?
	let actionTitle: String?

	var title: Text {
		Text(titleText)
	}

	var message: Text? {
		guard let messageText, !messageText.isEmpty else { return nil }
		return Text(messageText)
	}

	var image: Image? {
		Image(systemName: "lightbulb")
	}

	var actions: [Action] {
		guard let actionTitle, !actionTitle.isEmpty else { return [] }
		return [Action(id: "learn-more", title: actionTitle)]
	}

	var options: [TipOption] {
		[Tips.IgnoresDisplayFrequency(true)]
	}
}

@MainActor
enum TobyTips {
	private static var didConfigure = false

	static func configure() {
		guard !didConfigure else { return }
		didConfigure = true
		try? Tips.configure([.displayFrequency(.immediate)])
	}
}
