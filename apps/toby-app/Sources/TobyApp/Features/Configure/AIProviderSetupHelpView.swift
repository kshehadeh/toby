import SwiftUI

/// Setup tip shown on an AI provider’s credential page.
struct AIProviderSetupHelpView: View {
	let section: SettingsItem

	private var docURL: URL? {
		guard let docUrl = section.docUrl, !docUrl.isEmpty else { return nil }
		return URL(string: docUrl)
	}

	private var message: String {
		if let description = section.description, !description.isEmpty {
			return description
		}
		return "Follow the setup guide to create credentials for \(section.label)."
	}

	private var actionTitle: String {
		section.key == "ai.ollama" ? "Setup guide" : "How to get an API key"
	}

	var body: some View {
		SetupTipCard(
			tipId: "ai-setup-\(section.key)",
			title: "Set up \(section.label)",
			message: message,
			actionTitle: docURL == nil ? nil : actionTitle,
			actionURL: docURL,
			accessibilityId: "ai-provider-setup-help"
		)
	}
}
