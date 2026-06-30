import AppKit
import SwiftUI

struct SidebarHeader: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isServerRestarting: Bool
	let updateStore: UpdateStore?
	let onCheckForUpdates: () -> Void
	let onRestartServer: () -> Void

	private var appIcon: Image {
		if let nsImage = NSImage(named: NSImage.applicationIconName) {
			return Image(nsImage: nsImage)
		}
		return Image(systemName: "app.fill")
	}

	var body: some View {
		HStack(spacing: 10) {
			Button {
				onCheckForUpdates()
			} label: {
				HStack(spacing: 6) {
					appIcon
						.resizable()
						.aspectRatio(contentMode: .fit)
						.frame(width: 22, height: 22)
					Text("Toby")
						.font(.headline)
						.foregroundStyle(AppTheme.primaryText)
					if let version = status?.version {
						Text("v\(version)")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
					}
					if updateStore?.isUpgrading == true {
						Text("Updating")
							.font(.caption2.weight(.medium))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(.horizontal, 6)
							.padding(.vertical, 3)
							.background(
								Capsule()
									.fill(AppTheme.tertiaryText.opacity(0.12))
							)
							.overlay(
								Capsule()
									.stroke(AppTheme.tertiaryText.opacity(0.3), lineWidth: 1)
							)
							.accessibilityLabel("Updating Toby")
					} else if updateStore?.isUpdateAvailable == true, let latest = updateStore?.latestVersion {
						Text("Update")
							.font(.caption2.weight(.medium))
							.foregroundStyle(AppTheme.accent)
							.padding(.horizontal, 6)
							.padding(.vertical, 3)
							.background(
								Capsule()
									.fill(AppTheme.accent.opacity(0.18))
							)
							.overlay(
								Capsule()
									.stroke(AppTheme.accent.opacity(0.4), lineWidth: 1)
							)
							.accessibilityLabel("Update available, version \(latest)")
					}
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.disabled(updateStore?.isUpgrading == true)
			.accessibilityLabel("Toby version \(status?.version ?? "")")
			.accessibilityHint("Check for updates")
			Spacer(minLength: 0)
			ServerStatusButton(
				status: status,
				daemonStatus: daemonStatus,
				isRestarting: isServerRestarting,
				onRestart: onRestartServer
			)
		}
		.padding(.horizontal, 8)
		.padding(.bottom, 14)
	}
}
