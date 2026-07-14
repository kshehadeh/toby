import SwiftUI

/// Displays plan usage / balance info for a single AI provider.
/// Fetches from the daemon API and shows a compact summary or N/A.
struct AIProviderUsageView: View {
	let providerId: String

	@State private var usage: AIProviderUsage?
	@State private var isLoading = false

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 8) {
				Image(systemName: "creditcard")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)

				Text("Plan Usage")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(AppTheme.primaryText)

				Spacer()

				if isLoading {
					ProgressView()
						.scaleEffect(0.7)
						.frame(width: 14, height: 14)
				} else if let usage {
					Text(usage.displaySummary)
						.font(.subheadline)
						.foregroundStyle(
							usage.supported && usage.unavailableReason == nil
								? AppTheme.primaryText
								: AppTheme.tertiaryText
						)
				} else {
					Text("N/A")
						.font(.subheadline)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}

			if let usage, !usage.supported, let reason = usage.unavailableReason {
				Text(reason)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.fixedSize(horizontal: false, vertical: true)
			} else if let usage, usage.supported, let reason = usage.unavailableReason {
				Text(reason)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.fixedSize(horizontal: false, vertical: true)
			}
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
		.task(id: providerId) {
			await loadUsage()
		}
	}

	private func loadUsage() async {
		isLoading = true
		defer { isLoading = false }
		do {
			let client = TobyClient()
			usage = try await client.fetchAIProviderUsage(providerId: providerId)
		} catch {
			usage = nil
		}
	}
}
