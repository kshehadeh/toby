import SwiftUI

/// Setup tip shown on an AI provider’s credential page (accent-tinted tip card).
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

	var body: some View {
		SetupTipCard {
			VStack(alignment: .leading, spacing: 10) {
				Text(message)
					.font(.body)
					.foregroundStyle(SetupTipCardStyle.message)
					.textSelection(.enabled)
					.fixedSize(horizontal: false, vertical: true)
					.frame(maxWidth: .infinity, alignment: .leading)

				if let docURL {
					Link(destination: docURL) {
						HStack(spacing: 4) {
							Text(section.key == "ai.ollama" ? "Setup guide" : "How to get an API key")
								.font(.subheadline.weight(.semibold))
							Image(systemName: "arrow.up.right.square")
								.font(.subheadline.weight(.semibold))
						}
						.foregroundStyle(SetupTipCardStyle.link)
					}
					.help(docURL.absoluteString)
				}
			}
		}
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("ai-provider-setup-help")
	}
}
