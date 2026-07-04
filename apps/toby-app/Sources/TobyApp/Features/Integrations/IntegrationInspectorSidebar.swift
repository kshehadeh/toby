import SwiftUI

struct IntegrationInspectorSidebar: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	let status: IntegrationStatus?
	let isActionLoading: Bool
	let onAction: (IntegrationAction) -> Void

	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 18) {
					statusSection
					if status?.pluginPath != nil {
						Divider().overlay(SettingsDesign.cardBorder)
						locationSection
					}
					if let authMethods = status?.authMethods, !authMethods.isEmpty {
						Divider().overlay(SettingsDesign.cardBorder)
						authMethodsSection(methods: authMethods)
					}
				}
				.padding(18)
				.frame(maxWidth: .infinity, alignment: .leading)
			}

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 10) {
				if let status, status.connected {
					Button {
						onAction(.disconnect)
					} label: {
						Label("Disconnect", systemImage: "xmark")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(.bordered)
					.controlSize(.regular)
					.tint(.red)
					.disabled(isActionLoading)
					.accessibilityIdentifier("sidebar-disconnect-button")

					Button {
						onAction(.reauthorize)
					} label: {
						Label(status.reconnectionLabel, systemImage: "arrow.triangle.2.circlepath")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(.borderedProminent)
					.controlSize(.regular)
					.disabled(isActionLoading)
					.accessibilityIdentifier("sidebar-reconnect-button")
				} else {
					Button {
						onAction(.connect)
					} label: {
						Label("Connect", systemImage: "link")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(.borderedProminent)
					.controlSize(.regular)
					.disabled(isActionLoading)
					.accessibilityIdentifier("sidebar-connect-button")
				}
			}
			.padding(18)
		}
		.frame(width: 280)
		.background(AppTheme.sidebarBackground)
	}

	@ViewBuilder
	private var statusSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Status")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			if let status {
				HStack(spacing: 6) {
					Circle()
						.fill(status.connected ? (healthOk ? Color.green : Color.red) : AppTheme.tertiaryText)
						.frame(width: 6, height: 6)
					Text(status.connected ? "Connected" : "Not connected")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(SettingsDesign.rowTitle)
				}
				if let health = status.health, let details = health.details, !details.isEmpty {
					Text(details)
						.font(.system(size: 11))
						.foregroundStyle(health.ok ? Color.green.opacity(0.85) : Color.red.opacity(0.85))
						.fixedSize(horizontal: false, vertical: true)
						.textSelection(.enabled)
				}
			} else {
				Text("Status unavailable")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
	}

	private var locationSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Location")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			if let pluginPath = status?.pluginPath {
				RevealPathButton(path: pluginPath, label: "Plugin folder")
			}
		}
	}

	private var healthOk: Bool {
		guard let status else { return false }
		return status.connected && (status.health?.ok ?? false)
	}

	private func authMethodsSection(methods: [IntegrationAuthMethod]) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Authentication")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			ForEach(methods, id: \.id) { method in
				HStack(spacing: 6) {
					if method.isDefault == true {
						Image(systemName: "checkmark.circle.fill")
							.font(.system(size: 10))
							.foregroundStyle(AppTheme.accent)
					}
					Text(method.label)
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowTitle)
				}
			}
		}
	}
}
