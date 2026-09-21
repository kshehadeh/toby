import SwiftUI

/// Title row for an AI provider detail page: brand icon beside the name,
/// with Connected / Not connected status under the title.
struct AIProviderDetailHeader: View {
	let section: SettingsItem
	let isConnected: Bool?
	let isLoading: Bool

	private var iconUrl: URL? {
		guard let iconUrl = section.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	var body: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					titleIcon
				}
				.accessibilityHidden(true)

			VStack(alignment: .leading, spacing: 4) {
				Text(section.label)
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				statusLine
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("ai-provider-detail-header")
	}

	@ViewBuilder
	private var titleIcon: some View {
		if let iconUrl {
			SidebarIconView(
				url: iconUrl,
				fallbackSystemName: "sparkles",
				isSelected: true
			)
			.frame(width: 28, height: 28)
			.accessibilityHidden(true)
		} else if let icon = section.icon, !icon.isEmpty {
			Text(icon)
				.font(.system(size: 26))
				.accessibilityHidden(true)
		} else {
			Image(systemName: "sparkles")
				.font(.system(size: 22, weight: .medium))
				.foregroundStyle(AppTheme.accent)
				.accessibilityHidden(true)
		}
	}

	@ViewBuilder
	private var statusLine: some View {
		if isLoading {
			HStack(spacing: 6) {
				ProgressView()
					.scaleEffect(0.7)
					.accessibilityHidden(true)
				Text("Checking status…")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
			.accessibilityIdentifier("ai-provider-status-checking")
		} else if isConnected == true {
			HStack(spacing: 6) {
				Image(systemName: "checkmark.circle.fill")
					.font(.subheadline)
					.foregroundStyle(AppTheme.statusSuccessForeground)
					.accessibilityHidden(true)
				Text("Connected and ready")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
			.accessibilityIdentifier("ai-provider-status-connected")
		} else {
			HStack(spacing: 6) {
				Circle()
					.fill(AppTheme.tertiaryText)
					.frame(width: 6, height: 6)
					.accessibilityHidden(true)
				Text("Not connected")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
			.accessibilityIdentifier("ai-provider-status-not-connected")
		}
	}
}
