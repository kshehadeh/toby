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
			if plugin.state == "invalid", let error = plugin.error {
				Text(error)
					.font(.caption)
					.foregroundStyle(.red)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
			Text(plugin.statusLabel)
				.font(.caption.weight(.medium))
				.foregroundStyle(statusColor)
		}
		.padding(.vertical, 3)
	}
}
