import SwiftUI

/// First-run picker for providers that support guided setup.
struct AIProviderSetupChooserView: View {
	var onSelect: (String) -> Void
	var onDismiss: () -> Void
	var onBrowseAllProviders: () -> Void

	private struct Option: Identifiable {
		let id: String
		let title: String
		let subtitle: String
		let systemImage: String
		let isRecommended: Bool
	}

	private let options: [Option] = [
		Option(
			id: "vercel",
			title: "Vercel AI Gateway",
			subtitle: "Recommended — multi-model chat, free credits, web search & transcription catalogs",
			systemImage: "bolt.horizontal.circle.fill",
			isRecommended: true
		),
		Option(
			id: "openrouter",
			title: "OpenRouter",
			subtitle: "Hundreds of models from many vendors through one API key",
			systemImage: "arrow.triangle.branch",
			isRecommended: false
		),
	]

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					VStack(alignment: .leading, spacing: 6) {
						Text("Connect an AI provider")
							.font(.title3.weight(.semibold))
							.foregroundStyle(AppTheme.primaryText)
						Text("Pick a guided setup path. You can always change providers later in Settings.")
							.font(.subheadline)
							.foregroundStyle(AppTheme.secondaryText)
							.fixedSize(horizontal: false, vertical: true)
					}

					VStack(spacing: 12) {
						ForEach(options) { option in
							Button {
								onSelect(option.id)
							} label: {
								optionCard(option)
							}
							.buttonStyle(.plain)
							.accessibilityIdentifier("ai-provider-chooser-\(option.id)")
						}
					}
				}
				.padding(24)
			}

			Divider()
				.background(SettingsDesign.controlBorder)

			HStack {
				Button("Browse all providers…") {
					onBrowseAllProviders()
				}
				.accessibilityIdentifier("ai-provider-chooser-browse-all")

				Spacer()

				Button("Cancel") {
					onDismiss()
				}
				.keyboardShortcut(.escape, modifiers: [])
			}
			.padding(16)
		}
		.frame(minWidth: 480, idealWidth: 520, minHeight: 360)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("ai-provider-setup-chooser")
	}

	private func optionCard(_ option: Option) -> some View {
		HStack(alignment: .top, spacing: 14) {
			RoundedRectangle(cornerRadius: 10)
				.fill(AppTheme.accent.opacity(0.16))
				.frame(width: 40, height: 40)
				.overlay {
					Image(systemName: option.systemImage)
						.font(.system(size: 18, weight: .medium))
						.foregroundStyle(AppTheme.accent)
						.accessibilityHidden(true)
				}

			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 8) {
					Text(option.title)
						.font(.subheadline.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					if option.isRecommended {
						Text("Recommended")
							.font(.caption2.weight(.semibold))
							.foregroundStyle(AppTheme.accent)
							.padding(.horizontal, 6)
							.padding(.vertical, 2)
							.background(
								Capsule()
									.fill(AppTheme.accent.opacity(0.12))
							)
					}
				}
				Text(option.subtitle)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.multilineTextAlignment(.leading)
					.fixedSize(horizontal: false, vertical: true)
			}

			Spacer(minLength: 0)

			Image(systemName: "chevron.right")
				.font(.caption.weight(.semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityHidden(true)
		}
		.padding(14)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}
