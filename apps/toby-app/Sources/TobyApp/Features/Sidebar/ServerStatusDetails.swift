import SwiftUI

struct ServerStatusDetails: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let health: ServerHealth
	let isRestarting: Bool
	let onShowServerInfo: () -> Void
	let onRestart: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Circle()
					.fill(health.color)
					.frame(width: 8, height: 8)
				Text(health.label)
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.primaryText)
				Spacer()
			}
			HStack(spacing: 4) {
				Text(uptimeText)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
				if let pid = daemonStatus?.process?.pid {
					Text(verbatim: "· PID \(pid)")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}
			if let execPath = daemonStatus?.process?.executablePath, !execPath.isEmpty {
				RevealPathButton(path: execPath, label: "Server")
			}
			HStack(spacing: 8) {
				Spacer(minLength: 0)
				Button {
					onShowServerInfo()
				} label: {
					Label("Server Info", systemImage: "info.circle")
				}
				.buttonStyle(.bordered)
				.accessibilityLabel("Server Info")
				Button {
					onRestart()
				} label: {
					Label {
						Text(isRestarting ? "Restarting server…" : "Restart server")
					} icon: {
						if isRestarting {
							ProgressView()
								.controlSize(.small)
						} else {
							Image(systemName: "arrow.clockwise")
						}
					}
				}
				.buttonStyle(.bordered)
				.disabled(isRestarting)
				.accessibilityLabel(isRestarting ? "Restarting server" : "Restart server")
			}
			Divider()
				.background(AppTheme.separator)
			SlackStatusRow(status: status, daemonStatus: daemonStatus)
			ActiveChatRow(daemonStatus: daemonStatus)
		}
		.padding(12)
	}

	private var uptimeText: String {
		let formatted = formatDaemonUptime(seconds: daemonStatus?.process?.uptimeSeconds)
		if formatted == "Just started" {
			return formatted
		}
		return "Online for \(formatted)"
	}
}
