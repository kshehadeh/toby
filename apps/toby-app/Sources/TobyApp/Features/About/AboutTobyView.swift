import AppKit
import SwiftUI

struct AboutTobyView: View {
	@Bindable var changelogStore: ChangelogStore
	var updateStore: UpdateStore?
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
			await changelogStore.load()
		}
	}

	private var aboutPanel: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				appIdentity
				homeDirectorySection
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
				}
			} label: {
				Text("Refresh")
			}
			.buttonStyle(.link)
			.disabled(changelogStore.isLoading)
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
			name: "EventKit, Contacts, Speech, Network, AVFoundation",
			detail: "Apple Inc. — calendar, contacts, transcription, networking, and audio frameworks"
		),
		OpenSourceLibrary(
			name: "CoreMedia, ScreenCaptureKit, ApplicationServices",
			detail: "Apple Inc. — recording, capture, and automation system frameworks"
		),
		OpenSourceLibrary(
			name: "CoreWLAN, IOBluetooth, CoreAudio, CoreGraphics",
			detail: "Apple Inc. — macOS system control and rendering frameworks"
		),
		OpenSourceLibrary(name: "GRDB.swift", detail: "Gwendal Roué — SQLite storage"),
		OpenSourceLibrary(name: "Sparkle", detail: "sparkle-project.org — app updates"),
		OpenSourceLibrary(name: "ViewInspector", detail: "Aleksei Nadezhin — UI testing (test-only)"),
	]
}
