import SwiftUI

struct IntegrationDetailHeaderView: View {
	let section: SettingsItem
	let status: IntegrationStatus?
	let isLoading: Bool
	var description: String? = nil

	private var iconUrl: URL? {
		guard let iconUrl = section.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	private var connected: Bool {
		status?.connected ?? false
	}

	private var healthOk: Bool {
		guard let status else { return false }
		return status.connected && (status.health?.ok ?? false)
	}

	private var statusPillText: String {
		connected ? "Connected" : "Not connected"
	}

	private var statusPillColor: Color {
		if !connected { return AppTheme.tertiaryText }
		return healthOk ? .green : .red
	}

	var body: some View {
		HStack(alignment: .center, spacing: 14) {
			RoundedRectangle(cornerRadius: 13)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 56, height: 56)
				.overlay {
					titleIcon
				}

			VStack(alignment: .leading, spacing: 4) {
				Text(section.label)
					.font(.system(size: 20, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				if isLoading {
					HStack(spacing: 6) {
						ProgressView().scaleEffect(0.7)
						Text("Checking status…")
							.font(.subheadline)
							.foregroundStyle(AppTheme.secondaryText)
					}
				} else if let description, !description.isEmpty {
					Text(description)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.lineLimit(2)
						.truncationMode(.tail)
				}
			}

			Spacer(minLength: 12)

			HStack(spacing: 6) {
				Circle()
					.fill(statusPillColor)
					.frame(width: 6, height: 6)
				Text(statusPillText)
					.font(.system(size: 12, weight: .medium))
					.foregroundStyle(AppTheme.primaryText)
			}
			.padding(.horizontal, 10)
			.padding(.vertical, 5)
			.background(Color.white.opacity(0.05))
			.clipShape(Capsule())
			.overlay {
				Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1)
			}
		}
	}

	@ViewBuilder
	private var titleIcon: some View {
		if let iconUrl {
			SidebarIconView(url: iconUrl, fallbackSystemName: "puzzlepiece.extension", isSelected: true)
				.frame(width: 34, height: 34)
		} else if let icon = section.icon, !icon.isEmpty {
			Text(icon)
				.font(.system(size: 26))
		} else {
			Image(systemName: "puzzlepiece.extension")
				.font(.system(size: 24, weight: .medium))
				.foregroundStyle(AppTheme.accent)
		}
	}
}
