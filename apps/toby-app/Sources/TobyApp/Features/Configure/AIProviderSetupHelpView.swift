import SwiftUI

/// Setup tip shown on an AI provider’s credential page (and reuses the amber tip look).
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
		VStack(alignment: .leading, spacing: 10) {
			Text(message)
				.font(.body)
				.foregroundStyle(Color.white.opacity(0.92))
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
					.foregroundStyle(
						LinearGradient(
							colors: [
								Color(red: 1.0, green: 0.92, blue: 0.55),
								Color(red: 1.0, green: 0.78, blue: 0.28),
							],
							startPoint: .leading,
							endPoint: .trailing
						)
					)
				}
				.help(docURL.absoluteString)
			}
		}
		.padding(.leading, 36)
		.padding(.trailing, SettingsDesign.rowHorizontalPadding + 6)
		.padding(.vertical, SettingsDesign.rowVerticalPadding + 10)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(
					LinearGradient(
						colors: [
							Color(red: 0.42, green: 0.28, blue: 0.08).opacity(0.95),
							Color(red: 0.28, green: 0.18, blue: 0.06).opacity(0.95),
							Color(red: 0.18, green: 0.14, blue: 0.08).opacity(0.98),
						],
						startPoint: .topLeading,
						endPoint: .bottomTrailing
					)
				)
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(
					LinearGradient(
						colors: [
							Color(red: 0.96, green: 0.72, blue: 0.28).opacity(0.55),
							Color(red: 0.96, green: 0.62, blue: 0.12).opacity(0.18),
						],
						startPoint: .topLeading,
						endPoint: .bottomTrailing
					),
					lineWidth: 1
				)
		}
		.overlay(alignment: .topLeading) {
			Image(systemName: "lightbulb.fill")
				.font(.system(size: 48, weight: .semibold))
				.symbolRenderingMode(.hierarchical)
				.foregroundStyle(
					LinearGradient(
						colors: [
							Color(red: 1.0, green: 0.88, blue: 0.35),
							Color(red: 0.96, green: 0.62, blue: 0.12),
						],
						startPoint: .top,
						endPoint: .bottom
					)
				)
				.rotationEffect(.degrees(-30))
				.shadow(color: .black.opacity(0.45), radius: 10, x: 1, y: 3)
				.offset(x: -14, y: -18)
				.allowsHitTesting(false)
				.accessibilityHidden(true)
		}
		.padding(.top, 18)
		.padding(.leading, 14)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("ai-provider-setup-help")
	}
}
