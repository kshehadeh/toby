import SwiftUI

struct PluginRow: View {
	let plugin: PluginSummary

	private var statusColor: Color {
		switch plugin.state {
		case "disabled": return AppTheme.tertiaryText
		case "invalid": return .red
		default: return plugin.connected ? .green : AppTheme.secondaryText
		}
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(alignment: .firstTextBaseline, spacing: 6) {
				HStack(alignment: .firstTextBaseline, spacing: 4) {
					Text(plugin.displayName)
						.font(.callout)
						.foregroundStyle(AppTheme.primaryText)
					if let version = plugin.version, !version.isEmpty {
						Text("v\(version)")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
					}
				}
				Spacer(minLength: 0)
				Text(plugin.statusLabel)
					.font(.caption.weight(.medium))
					.foregroundStyle(statusColor)
			}
			if plugin.state == "invalid", let error = plugin.error, !error.isEmpty {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
		}
		.padding(.vertical, 3)
	}
}
