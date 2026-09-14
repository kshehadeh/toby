import SwiftUI

/// Labelled recovery control shown only when the daemon is not healthy.
struct SidebarConnectionStatus: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isRestarting: Bool
	var isConnecting: Bool = false
	var lifecycleMessage: String? = nil
	let onRestart: () -> Void

	private var health: ServerHealth {
		ServerHealth.resolve(
			status: status,
			daemonStatus: daemonStatus,
			isRestarting: isRestarting,
			isConnecting: isConnecting
		)
	}

	var body: some View {
		if health != .connected {
			ServerStatusButton(
				status: status,
				daemonStatus: daemonStatus,
				isRestarting: isRestarting,
				isConnecting: isConnecting,
				lifecycleMessage: lifecycleMessage,
				style: .labeled,
				onRestart: onRestart
			)
			.padding(.horizontal, 8)
			.padding(.vertical, 4)
			.accessibilityIdentifier("sidebar-connection-status")
		}
	}
}
