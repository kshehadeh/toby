import AppKit
import SwiftUI

struct AboutTobyView: View {
	@Bindable var changelogStore: ChangelogStore
	var updateStore: UpdateStore?
	@Bindable var pluginsStore: PluginsStore
	var appVersion: String?
	var tobyDirectory: String?
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
				homeDirectorySection
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

	private var homeDirectorySection: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Home Directory")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			if let tobyDirectory, !tobyDirectory.isEmpty {
				RevealPathButton(path: tobyDirectory, label: "Toby home directory")
			} else {
				Text("Waiting for server…")
					.font(.callout)
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
	}

	private var pluginsSection: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Plugins")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			if let dir = pluginsStore.pluginsDirectory, !dir.isEmpty {
				RevealPathButton(path: dir, label: "Plugin directory")
			}
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
					onDismiss?()
					Task { await updateStore.performUpgrade() }
				} label: {
					Text("Upgrade to v\(latest)")
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
		OpenSourceLibrary(
			name: "EventKit, Network, AVFoundation",
			detail: "Apple Inc. — calendar, networking, and audio/video system frameworks"
		),
		OpenSourceLibrary(
			name: "CoreMedia, ScreenCaptureKit, ApplicationServices",
			detail: "Apple Inc. — recording, capture, and automation system frameworks"
		),
		OpenSourceLibrary(
			name: "CoreWLAN, IOBluetooth, CoreAudio, CoreGraphics",
			detail: "Apple Inc. — macOS system control and rendering frameworks"
		),
		OpenSourceLibrary(name: "Bun", detail: "oven-sh — JavaScript runtime, bundled server, plugins, and SQLite storage"),
		OpenSourceLibrary(name: "Sparkle", detail: "sparkle-project.org — app updates"),
		OpenSourceLibrary(
			name: "STTextView, STTextKitPlus, CoreTextSwift",
			detail: "Krzyzanowskim — native log and text editing components"
		),
		OpenSourceLibrary(
			name: "AI SDK, @ai-sdk/gateway, @ai-sdk/openai, @ai-sdk/groq, @ai-sdk/openai-compatible",
			detail: "Vercel — chat, tool calling, streaming, transcription, and model providers"
		),
		OpenSourceLibrary(
			name: "React, Ink, ink-link, react-ink-textarea",
			detail: "terminal UI framework and CLI text input components"
		),
		OpenSourceLibrary(name: "Commander, Chalk", detail: "CLI command routing and terminal output styling"),
		OpenSourceLibrary(name: "Croner", detail: "cron parsing and recurring schedule execution"),
		OpenSourceLibrary(name: "Zod", detail: "configuration, plugin protocol, and tool argument validation"),
		OpenSourceLibrary(
			name: "Mozilla Readability, linkedom",
			detail: "web page extraction and HTML parsing for fetched content"
		),
		OpenSourceLibrary(name: "googleapis", detail: "Google API client support for calendar and related integrations"),
		OpenSourceLibrary(name: "open", detail: "cross-platform browser and file opener"),
		OpenSourceLibrary(name: "@slack/bolt", detail: "Slack app, OAuth, Socket Mode, and inbound chat support"),
		OpenSourceLibrary(name: "@doist/todoist-sdk", detail: "Todoist task integration client"),
		OpenSourceLibrary(name: "ImapFlow, mailparser, Nodemailer", detail: "IMAP, email parsing, and SMTP support"),
		OpenSourceLibrary(
			name: "Docusaurus, MDX, Prism React Renderer, lucide-react",
			detail: "documentation site framework, content rendering, code highlighting, and icons"
		),
		OpenSourceLibrary(name: "ViewInspector", detail: "Aleksei Nadezhin — UI testing (test-only)"),
	]
}
