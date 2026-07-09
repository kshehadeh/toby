import SwiftUI

enum ServerHealth: String {
	case connected
	case starting
	case offline

	var color: Color {
		switch self {
		case .connected: .green
		case .starting: .yellow
		case .offline: .red
		}
	}

	var label: String {
		switch self {
		case .connected: "Server connected"
		case .starting: "Server starting"
		case .offline: "Server offline"
		}
	}
}

struct ServerStatusButton: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isRestarting: Bool
	let onRestart: () -> Void
	@State private var isPresented = false
	@State private var isServerInfoPresented = false
	@State private var isHovered = false

	private var health: ServerHealth {
		if isRestarting { return .starting }
		if status != nil { return .connected }
		if daemonStatus?.process != nil { return .starting }
		return .offline
	}

	var body: some View {
		Button {
			isPresented.toggle()
		} label: {
			Circle()
				.fill(health.color)
				.frame(width: 10, height: 10)
				.overlay(
					Circle()
						.stroke(health.color.opacity(isHovered ? 0.35 : 0), lineWidth: 4)
						.scaleEffect(isHovered ? 1.8 : 1)
				)
				.padding(8)
				.background(
					Circle()
						.fill(AppTheme.primaryText.opacity(isHovered ? 0.1 : 0))
				)
				.contentShape(Circle())
				.animation(.easeInOut(duration: 0.15), value: isHovered)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.accessibilityLabel(health.label)
		.accessibilityHint("Show server details")
		.popover(isPresented: $isPresented, arrowEdge: .top) {
			ServerStatusDetails(
				status: status,
				daemonStatus: daemonStatus,
				health: health,
				isRestarting: isRestarting,
				onShowServerInfo: {
					isPresented = false
					isServerInfoPresented = true
				},
				onRestart: onRestart
			)
			.frame(width: 320)
		}
		.sheet(isPresented: $isServerInfoPresented) {
			ServerInfoView(
				status: status,
				daemonStatus: daemonStatus,
				health: health,
				isRestarting: isRestarting,
				onRestart: onRestart,
				onDismiss: {
					isServerInfoPresented = false
				}
			)
		}
	}
}
