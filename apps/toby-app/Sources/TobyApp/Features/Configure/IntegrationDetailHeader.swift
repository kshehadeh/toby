import SwiftUI

/// Top of an integration's settings form: the app's icon, name and a plain
/// status, plus Connect, Re-authorize when something is wrong, or
/// Check connection when healthy. Setup guide, plugin location,
/// Disconnect and Remove live in `IntegrationSettingsAboutSections`.
struct IntegrationDetailHeader: View {
	@Bindable var store: ConfigureStore
	let section: SettingsItem
	let status: IntegrationStatus?
	let isLoading: Bool
	let isActionLoading: Bool
	let onAction: (IntegrationAction) -> Void
	var onCheckConnection: (() -> Void)? = nil
	var onRemove: (() -> Void)? = nil
	/// Kept for call sites; the setup guide row is in the About section.
	var onOpenSetupGuide: (() -> Void)? = nil

	private var iconUrl: URL? {
		guard let iconUrl = section.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack(spacing: 14) {
				iconTile
				VStack(alignment: .leading, spacing: 5) {
					Text(section.label)
						.font(.system(size: 17, weight: .semibold))
						.foregroundStyle(AppTheme.primaryText)
					statusLine
				}
				Spacer(minLength: 12)
				primaryAction
			}
			.padding(.vertical, 4)

			if let issue = IntegrationHeaderState.issue(for: status) {
				Divider()
					.padding(.top, 12)
				HStack(alignment: .firstTextBaseline, spacing: 10) {
					Image(systemName: "exclamationmark.triangle.fill")
						.symbolRenderingMode(.multicolor)
						.font(.system(size: 13))
						.accessibilityHidden(true)
					VStack(alignment: .leading, spacing: 2) {
						Text("Toby can’t reach \(section.label) right now.")
							.font(.system(size: 13, weight: .medium))
							.foregroundStyle(AppTheme.primaryText)
						Text(issue)
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.secondaryText)
							.fixedSize(horizontal: false, vertical: true)
							.textSelection(.enabled)
					}
				}
				.padding(.top, 10)
				.accessibilityElement(children: .combine)
				.accessibilityIdentifier("integration-health-issue")
			}
		}
	}

	private var iconTile: some View {
		RoundedRectangle(cornerRadius: 12, style: .continuous)
			.fill(Color.white)
			.frame(width: 48, height: 48)
			.overlay {
				RoundedRectangle(cornerRadius: 12, style: .continuous)
					.strokeBorder(AppTheme.separator, lineWidth: 1)
			}
			.overlay { titleIcon }
			.accessibilityHidden(true)
	}

	@ViewBuilder
	private var titleIcon: some View {
		if let iconUrl {
			SidebarIconView(url: iconUrl, fallbackSystemName: "puzzlepiece.extension", isSelected: true)
				.frame(width: 30, height: 30)
		} else if let icon = section.icon, !icon.isEmpty {
			Text(icon)
				.font(.system(size: 26))
		} else {
			Image(systemName: "puzzlepiece.extension")
				.font(.system(size: 20, weight: .medium))
				.foregroundStyle(Color.gray)
		}
	}

	@ViewBuilder
	private var primaryAction: some View {
		if let status {
			if !status.connected {
				Button("Connect") { onAction(.connect) }
					.buttonStyle(.borderedProminent)
					.disabled(isActionLoading || isLoading)
					.accessibilityIdentifier("integration-connect-button")
			} else if IntegrationHeaderState.needsAttention(status) {
				Button(status.reconnectionLabel) { onAction(.reauthorize) }
					.buttonStyle(.borderedProminent)
					.disabled(isActionLoading || isLoading)
					.accessibilityIdentifier("integration-reauthorize-button")
			} else {
				Button("Check connection") { onCheckConnection?() }
					.buttonStyle(.bordered)
					.disabled(isActionLoading || isLoading)
					.accessibilityIdentifier("integration-check-connection-button")
			}
		}
	}

	@ViewBuilder
	private var statusLine: some View {
		if isLoading {
			HStack(spacing: 6) {
				ProgressView()
					.controlSize(.mini)
				Text("Checking status…")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.secondaryText)
			}
		} else if let status {
			HStack(spacing: 8) {
				if IntegrationHeaderState.needsAttention(status) {
					Text("Needs attention")
						.font(.system(size: 11, weight: .semibold))
						.foregroundStyle(AppTheme.statusErrorForeground)
						.padding(.horizontal, 8)
						.padding(.vertical, 2)
						.background(Capsule().fill(AppTheme.statusErrorBackground))
				} else {
					HStack(spacing: 6) {
						Circle()
							.fill(status.connected ? Color.green : AppTheme.tertiaryText)
							.frame(width: 7, height: 7)
							.accessibilityHidden(true)
						Text(status.connected ? "Connected" : "Not connected")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.secondaryText)
					}
				}
				if status.connected, let method = signedInWith(status) {
					Text(method)
						.font(.system(size: 12))
						.foregroundStyle(AppTheme.secondaryText)
				}
			}
		} else {
			HStack(spacing: 6) {
				Circle()
					.fill(AppTheme.tertiaryText)
					.frame(width: 7, height: 7)
				Text("Status unavailable")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
	}

	private func signedInWith(_ status: IntegrationStatus) -> String? {
		guard let methods = status.authMethods, !methods.isEmpty else { return nil }
		let selected = store.resolvedAuthMethod(for: section)
		guard let method = methods.first(where: { $0.id == selected }) else { return nil }
		return "Signed in with \(IntegrationHeaderState.methodName(method.label))"
	}
}

/// Pure rules behind the header, kept separate so tests can check them.
enum IntegrationHeaderState {
	static func needsAttention(_ status: IntegrationStatus) -> Bool {
		status.connected && status.health?.ok == false
	}

	/// The plugin's own explanation (or a hint to reconnect), shown only while
	/// connected but unhealthy.
	static func issue(for status: IntegrationStatus?) -> String? {
		guard let status, needsAttention(status) else { return nil }
		let details = status.health?.details?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return details.isEmpty ? "\(status.reconnectionLabel) to sign in again." : details
	}

	/// "OAuth (recommended)" → "OAuth"; used for picker segments and status.
	static func methodName(_ label: String) -> String {
		label
			.replacingOccurrences(of: "(recommended)", with: "", options: .caseInsensitive)
			.trimmingCharacters(in: .whitespacesAndNewlines)
	}
}
