import SwiftUI

/// Modal explaining why inbound chat (e.g. Slack) is not connected.
struct InboundChatDetailsView: View {
	let inbound: ChatInboundStatus?
	var onDismiss: (() -> Void)? = nil

	var body: some View {
		VStack(spacing: 0) {
			header
				.padding(.horizontal, 20)
				.padding(.top, 20)
				.padding(.bottom, 12)

			Divider()
				.background(AppTheme.separator)

			ScrollView {
				VStack(alignment: .leading, spacing: 16) {
					statusRow
					infoRow(title: "Integration", value: integrationDisplay)
					if inbound?.enabled == true {
						infoRow(title: "Enabled", value: "Yes")
					} else if inbound != nil {
						infoRow(title: "Enabled", value: "No")
					}
					reasonSection
					guidanceSection
				}
				.padding(20)
				.frame(maxWidth: .infinity, alignment: .leading)
			}

			Divider()
				.background(AppTheme.separator)

			HStack {
				Spacer(minLength: 0)
				Button("Done") {
					onDismiss?()
				}
				.keyboardShortcut(.defaultAction)
				.accessibilityLabel("Close inbound chat details")
			}
			.padding(.horizontal, 20)
			.padding(.vertical, 14)
		}
		.frame(width: 440, height: 360)
		.background(AppTheme.contentBackground)
	}

	private var header: some View {
		HStack(spacing: 10) {
			Image(systemName: "bubble.left.and.bubble.right")
				.font(.title2)
				.foregroundStyle(AppTheme.accent)
				.accessibilityHidden(true)
			Text("Inbound Chat")
				.font(.title2.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
		.accessibilityAddTraits(.isHeader)
	}

	private var statusRow: some View {
		HStack(alignment: .firstTextBaseline) {
			Text("Status")
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 120, alignment: .leading)
			HStack(spacing: 6) {
				Circle()
					.fill(statusColor)
					.frame(width: 8, height: 8)
				Text(statusLabel)
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.primaryText)
			}
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Status, \(statusLabel)")
	}

	@ViewBuilder
	private var reasonSection: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Reason")
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
			Text(reasonText)
				.font(.callout)
				.foregroundStyle(AppTheme.primaryText)
				.fixedSize(horizontal: false, vertical: true)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(12)
				.background(
					RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius, style: .continuous)
						.fill(AppTheme.primaryText.opacity(0.06))
				)
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Reason, \(reasonText)")
	}

	@ViewBuilder
	private var guidanceSection: some View {
		if shouldShowGuidance {
			VStack(alignment: .leading, spacing: 6) {
				Text("What to check")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
				Text(guidanceText)
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
					.frame(maxWidth: .infinity, alignment: .leading)
			}
			.accessibilityElement(children: .combine)
		}
	}

	@ViewBuilder
	private func infoRow(title: String, value: String) -> some View {
		HStack(alignment: .firstTextBaseline) {
			Text(title)
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 120, alignment: .leading)
			Text(value)
				.font(.callout)
				.foregroundStyle(AppTheme.primaryText)
				.textSelection(.enabled)
			Spacer(minLength: 0)
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel("\(title), \(value)")
	}

	private var statusLabel: String {
		inbound?.connectionLabel ?? "Unknown"
	}

	private var statusColor: Color {
		guard let inbound else { return AppTheme.tertiaryText }
		if inbound.isConnected { return .green }
		if !inbound.enabled || inbound.status == "disabled" {
			return AppTheme.tertiaryText
		}
		switch inbound.status {
		case "connecting": return .yellow
		case "error": return .red
		case "idle": return .orange
		default: return AppTheme.tertiaryText
		}
	}

	private var integrationDisplay: String {
		if let label = inbound?.integrationLabel, !label.isEmpty {
			return label
		}
		if let name = inbound?.integration, !name.isEmpty {
			return name
		}
		return "—"
	}

	private var reasonText: String {
		if let inbound {
			return inbound.disconnectExplanation ?? "No additional detail available."
		}
		return "Inbound status is not available. The server may still be starting, or the daemon status request failed."
	}

	private var shouldShowGuidance: Bool {
		guard let inbound else { return true }
		return !inbound.isConnected
	}

	private var guidanceText: String {
		"""
		In Toby settings, open Daemon / inbound chat and confirm inbound is enabled with the right active integration (for Slack: bot token + app token for Socket Mode). Then restart the server if you changed credentials.
		"""
	}
}
