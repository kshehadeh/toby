import SwiftUI

struct AboutTobyView: View {
	@Bindable var changelogStore: ChangelogStore
	var updateStore: UpdateStore?
	@Bindable var pluginsStore: PluginsStore
	var appVersion: String?
	var onDismiss: (() -> Void)? = nil

	private let dateFormatter: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .none
		return formatter
	}()

	private var appIcon: Image {
		if let nsImage = NSImage(named: NSImage.applicationIconName) {
			return Image(nsImage: nsImage)
		}
		return Image(systemName: "app.fill")
	}

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .top, spacing: 0) {
				aboutPanel
					.frame(maxWidth: .infinity, alignment: .leading)
				Divider()
					.background(AppTheme.separator)
				changelogPanel
					.frame(maxWidth: .infinity, alignment: .leading)
			}

			Divider()
				.background(AppTheme.separator)
				.padding(.vertical, 12)

			bottomBar
				.padding(.horizontal, 24)
				.padding(.bottom, 16)
		}
		.frame(
			minWidth: 720, idealWidth: 780, maxWidth: 880,
			minHeight: 480, idealHeight: 560, maxHeight: 720
		)
		.background(AppTheme.contentBackground)
		.task {
			async let changelog: () = changelogStore.load()
			async let plugins: () = pluginsStore.load()
			_ = await (changelog, plugins)
		}
	}

	private var aboutPanel: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				appIdentity
				pluginsSection
				openSourceSection
			}
			.padding(24)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	private var appIdentity: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 12) {
				appIcon
					.resizable()
					.aspectRatio(contentMode: .fit)
					.frame(width: 56, height: 56)
				VStack(alignment: .leading, spacing: 2) {
					Text("Toby")
						.font(.title2.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text("Version \(appVersion ?? "—")")
						.font(.callout)
						.foregroundStyle(AppTheme.secondaryText)
				}
				Spacer(minLength: 0)
			}
		}
	}

	private var pluginsSection: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Plugins")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			if pluginsStore.isLoading && pluginsStore.plugins.isEmpty {
				Text("Loading plugins…")
					.font(.callout)
					.foregroundStyle(AppTheme.tertiaryText)
			} else if let error = pluginsStore.errorMessage {
				Text(error)
					.font(.caption)
					.foregroundStyle(.red)
					.fixedSize(horizontal: false, vertical: true)
			} else if pluginsStore.plugins.isEmpty {
				Text("No plugins installed.")
					.font(.callout)
					.foregroundStyle(AppTheme.tertiaryText)
			} else {
				VStack(alignment: .leading, spacing: 6) {
					ForEach(pluginsStore.plugins) { plugin in
						PluginRow(plugin: plugin)
					}
				}
			}
		}
	}

	private var openSourceSection: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Open Source Libraries")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			VStack(alignment: .leading, spacing: 4) {
				ForEach(AboutTobyView.openSourceLibraries, id: \.name) { library in
					HStack(alignment: .top, spacing: 6) {
						Text("•")
							.foregroundStyle(AppTheme.tertiaryText)
							.font(.callout)
						VStack(alignment: .leading, spacing: 1) {
							Text(library.name)
								.font(.callout)
								.foregroundStyle(AppTheme.primaryText)
							Text(library.detail)
								.font(.caption)
								.foregroundStyle(AppTheme.secondaryText)
						}
						Spacer(minLength: 0)
					}
				}
			}
			if let url = URL(string: "https://github.com/toby-ai/toby") {
				Link(destination: url) {
					Label("View source on GitHub", systemImage: "arrow.up.right.square")
						.font(.caption)
						.foregroundStyle(AppTheme.accent)
				}
				.padding(.top, 4)
			}
		}
	}

	private var changelogPanel: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("What's New")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
				.padding(.bottom, 12)
			ChangelogReleasesView(
				store: changelogStore,
				updateStore: updateStore,
				dateFormatter: dateFormatter
			)
		}
		.padding(24)
	}

	private var bottomBar: some View {
		HStack {
			Button {
				Task {
					await changelogStore.load(force: true)
					await pluginsStore.load()
				}
			} label: {
				Text("Refresh")
			}
			.buttonStyle(.link)
			.disabled(changelogStore.isLoading || pluginsStore.isLoading)
			.accessibilityLabel("Refresh")

			Spacer()

			if let updateStore, updateStore.isUpdateAvailable, let latest = updateStore.latestVersion {
				Button {
					Task { await updateStore.performUpgrade() }
				} label: {
					if updateStore.isUpgrading {
						HStack(spacing: 6) {
							ProgressView()
								.controlSize(.small)
							Text("Upgrading…")
						}
					} else {
						Text("Upgrade to v\(latest)")
					}
				}
				.disabled(updateStore.isUpgrading)
				.accessibilityLabel("Upgrade to version \(latest)")
			}

			Button("Done") {
				onDismiss?()
			}
			.accessibilityLabel("Close about dialog")
		}
	}

	private struct OpenSourceLibrary {
		let name: String
		let detail: String
	}

	private static let openSourceLibraries: [OpenSourceLibrary] = [
		OpenSourceLibrary(name: "SwiftUI, AppKit", detail: "Apple Inc. — UI framework"),
		OpenSourceLibrary(name: "EventKit, Network, AVFoundation", detail: "Apple Inc. — system frameworks"),
		OpenSourceLibrary(name: "CoreMedia, ScreenCaptureKit, ApplicationServices", detail: "Apple Inc. — system frameworks"),
		OpenSourceLibrary(name: "ViewInspector", detail: "Aleksei Nadezhin — UI testing (test-only)"),
	]
}

private struct PluginRow: View {
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
			VStack(alignment: .leading, spacing: 1) {
				Text(plugin.displayName)
					.font(.callout)
					.foregroundStyle(AppTheme.primaryText)
				if let version = plugin.version, !version.isEmpty {
					Text("v\(version)")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				} else if plugin.state == "invalid", let error = plugin.error {
					Text(error)
						.font(.caption)
						.foregroundStyle(.red)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
			Text(plugin.statusLabel)
				.font(.caption.weight(.medium))
				.foregroundStyle(statusColor)
		}
		.padding(.vertical, 3)
	}
}
