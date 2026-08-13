import AppKit
import SwiftUI

struct SidebarHeader: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?
	let isServerRestarting: Bool
	var isServerConnecting: Bool = false
	var serverLifecycleMessage: String? = nil
	var isRecordingActive: Bool = false
	var isRecordingProcessing: Bool = false
	let updateStore: UpdateStore?
	let onCheckForUpdates: () -> Void
	let onRestartServer: () -> Void

	private var appIcon: Image {
		if let logoURL = Bundle.tobyResources.url(forResource: "toby-128", withExtension: "png"),
			let nsImage = NSImage(contentsOf: logoURL)
		{
			// Full-color logo art (not an alpha glyph) — do not mark as template.
			nsImage.isTemplate = false
			return Image(nsImage: nsImage)
		}
		return Image(systemName: "brain.head.profile")
	}

	var body: some View {
		HStack(spacing: 10) {
			Button {
				onCheckForUpdates()
			} label: {
				HStack(spacing: 8) {
					appIcon
						.resizable()
						.interpolation(.high)
						.antialiased(true)
						.aspectRatio(contentMode: .fit)
						.frame(width: 33, height: 33)
					VStack(alignment: .leading, spacing: 0) {
						HStack(alignment: .center, spacing: 6) {
							Text("TOBY")
								.font(.system(size: 19, weight: .bold))
								.foregroundStyle(AppTheme.primaryText)
								.fixedSize(horizontal: true, vertical: false)
							if isRecordingActive {
								ActivePulseIcon(color: .red, isProminent: true)
									.accessibilityIdentifier("sidebar-recording-indicator")
									.accessibilityLabel("Recording in progress")
							} else if isRecordingProcessing {
								ActivePulseIcon(color: .orange, isProminent: true)
									.accessibilityIdentifier("sidebar-recording-processing-indicator")
									.accessibilityLabel("Processing recording")
							}
						}
						if let version = status?.version {
							if updateStore?.isUpgrading == true {
								Text("Updating")
									.font(.caption2.weight(.medium))
									.foregroundStyle(AppTheme.tertiaryText)
									.lineLimit(1)
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
								Text("v\(latest) is available now")
									.font(.caption)
									.foregroundStyle(AppTheme.accent)
									.lineLimit(1)
							} else {
								Text("v\(version)")
									.font(.caption)
									.foregroundStyle(AppTheme.tertiaryText)
									.lineLimit(1)
							}
						} else if isServerConnecting || isServerRestarting,
							let message = serverLifecycleMessage, !message.isEmpty
						{
							Text(message)
								.font(.caption)
								.foregroundStyle(AppTheme.tertiaryText)
								.lineLimit(1)
						}
					}
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.disabled(updateStore?.isUpgrading == true)
			.accessibilityLabel(headerAccessibilityLabel)
			.accessibilityHint("Check for updates")
			Spacer(minLength: 0)
			ServerStatusButton(
				status: status,
				daemonStatus: daemonStatus,
				isRestarting: isServerRestarting,
				isConnecting: isServerConnecting,
				lifecycleMessage: serverLifecycleMessage,
				onRestart: onRestartServer
			)
		}
		.padding(.horizontal, 8)
		.padding(.bottom, 14)
	}

	private var headerAccessibilityLabel: String {
		let version = status?.version ?? ""
		if isRecordingActive {
			return "Toby version \(version), recording in progress"
		}
		if isRecordingProcessing {
			return "Toby version \(version), processing recording"
		}
		return "Toby version \(version)"
	}
}
