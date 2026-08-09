import SwiftUI

/// Shows daemon inbound-chat connectivity (e.g. Slack Socket Mode), not OAuth tool connect.
struct InboundChatStatusRow: View {
	let daemonStatus: DaemonStatus?
	var onShowDetails: (() -> Void)? = nil

	var body: some View {
		HStack(spacing: 8) {
			VStack(alignment: .leading, spacing: 2) {
				Text("Inbound chat")
					.font(.caption)
					.foregroundStyle(AppTheme.primaryText)
				if let subtitle {
					Text(subtitle)
						.font(.caption2)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 8)
			statusBadge
			if showsDetailsButton {
				Button {
					onShowDetails?()
				} label: {
					Label("Why?", systemImage: "info.circle")
						.font(.caption)
						.labelStyle(.titleAndIcon)
				}
				.buttonStyle(.borderless)
				.help("Show why inbound chat is not connected")
				.accessibilityLabel("Why is inbound chat disconnected")
				.accessibilityHint("Opens details about the inbound chat disconnect")
			}
		}
		.accessibilityElement(children: .combine)
		.accessibilityLabel(accessibilitySummary)
	}

	@ViewBuilder
	private var statusBadge: some View {
		let appearance = badgeAppearance
		HStack(spacing: 4) {
			Circle()
				.fill(appearance.dot)
				.frame(width: 6, height: 6)
			Text(appearance.label)
				.font(.caption)
				.foregroundStyle(appearance.text)
		}
		.padding(.horizontal, 6)
		.padding(.vertical, 2)
		.background(
			Capsule()
				.fill(appearance.dot.opacity(0.15))
		)
		.overlay(
			Capsule()
				.stroke(appearance.dot.opacity(0.35), lineWidth: 1)
		)
	}

	private var inbound: ChatInboundStatus? {
		daemonStatus?.chatInbound
	}

	private var subtitle: String? {
		guard let inbound else { return "Status unavailable" }
		let title = inbound.displayTitle
		// Avoid repeating "Inbound chat" as both title and subtitle.
		if title == "Inbound chat" { return nil }
		return title
	}

	private var showsDetailsButton: Bool {
		guard let inbound else { return true }
		return !inbound.isConnected
	}

	private var accessibilitySummary: String {
		guard let inbound else {
			return "Inbound chat, status unavailable"
		}
		if let subtitle, subtitle != inbound.connectionLabel {
			return "Inbound chat, \(subtitle), \(inbound.connectionLabel)"
		}
		return "Inbound chat, \(inbound.connectionLabel)"
	}

	private var badgeAppearance: (label: String, dot: Color, text: Color) {
		guard let inbound else {
			return ("Unknown", AppTheme.tertiaryText, AppTheme.tertiaryText)
		}
		if inbound.isConnected {
			return ("Connected", .green, AppTheme.secondaryText)
		}
		if !inbound.enabled || inbound.status == "disabled" {
			return ("Disabled", AppTheme.tertiaryText, AppTheme.tertiaryText)
		}
		switch inbound.status {
		case "connecting":
			return ("Connecting…", .yellow, AppTheme.secondaryText)
		case "error":
			return ("Error", .red, AppTheme.secondaryText)
		case "idle":
			return ("Idle", .orange, AppTheme.secondaryText)
		default:
			return (inbound.connectionLabel, AppTheme.tertiaryText, AppTheme.tertiaryText)
		}
	}
}
