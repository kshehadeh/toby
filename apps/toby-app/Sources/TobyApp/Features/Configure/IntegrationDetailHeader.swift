import SwiftUI

struct IntegrationDetailHeader: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	let status: IntegrationStatus?
	let isLoading: Bool
	let isActionLoading: Bool
	let onAction: (IntegrationAction) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(spacing: 14) {
				RoundedRectangle(cornerRadius: 12)
					.fill(AppTheme.accent.opacity(0.18))
					.frame(width: 48, height: 48)
					.overlay {
						Image(systemName: "puzzlepiece.extension")
							.font(.system(size: 22, weight: .medium))
							.foregroundStyle(AppTheme.accent)
					}
				VStack(alignment: .leading, spacing: 4) {
					Text(section.label)
						.font(.title3.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					statusLine
				}
			}

			if let status {
				if let pluginPath = status.pluginPath {
					Text("Plugin: \(pluginPath)")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.textSelection(.enabled)
				}

				if let health = status.health, let details = health.details, !details.isEmpty {
					Text(details)
						.font(.subheadline)
						.foregroundStyle(health.ok ? Color.green.opacity(0.85) : Color.red.opacity(0.85))
						.fixedSize(horizontal: false, vertical: true)
				}

				HStack(spacing: 10) {
					SettingsActionButton(title: "Setup Guide") {
						Task {
							await store.loadSetupGuide(for: section.key)
						}
					}
					.disabled(isActionLoading)
					if !status.connected {
						SettingsActionButton(title: "Connect") {
							onAction(.connect)
						}
						.disabled(isActionLoading)
					}
					if status.connected {
						SettingsActionButton(title: "Disconnect") {
							onAction(.disconnect)
						}
						.disabled(isActionLoading)
						SettingsActionButton(title: status.reconnectionLabel) {
							onAction(.reauthorize)
						}
						.disabled(isActionLoading)
					}
					if status.supportsSetup {
						SettingsActionButton(title: "Run Setup") {
							onAction(.setup)
						}
						.disabled(isActionLoading)
					}
				}
				.padding(.top, 4)
			}
		}
	}

	@ViewBuilder
	private var statusLine: some View {
		if isLoading {
			HStack(spacing: 6) {
				ProgressView()
					.scaleEffect(0.7)
				Text("Checking status…")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		} else if let status {
			HStack(spacing: 6) {
				Circle()
					.fill(status.connected ? (healthOk ? Color.green : Color.red) : AppTheme.tertiaryText)
					.frame(width: 6, height: 6)
				Text(statusText)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		} else {
			HStack(spacing: 6) {
				Circle()
					.fill(AppTheme.tertiaryText)
					.frame(width: 6, height: 6)
				Text("Status unavailable")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
	}

	private var healthOk: Bool {
		guard let status else { return false }
		return status.connected && (status.health?.ok ?? false)
	}

	private var statusText: String {
		guard let status else { return "Status unavailable" }
		if status.connected {
			if let health = status.health, !(health.ok) {
				return "Connected · Authentication invalid"
			}
			return "Connected · Authentication valid"
		}
		return "Not connected"
	}
}
