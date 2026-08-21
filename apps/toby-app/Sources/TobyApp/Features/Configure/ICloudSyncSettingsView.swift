import AppKit
import SwiftUI

/// Client-orchestrated settings sync tab. Crypto and apply/restore live
/// in the daemon; this view only drives `/api/config/sync*`.
struct ICloudSyncSettingsView: View {
	var client: TobyClient = TobyClient()
	/// When set, skip network fetches (previews and ViewInspector tests).
	var previewStatus: ConfigSyncStatus? = nil
	var previewHistory: [ConfigSyncHistoryItem] = []

	@State private var status: ConfigSyncStatus?
	@State private var history: [ConfigSyncHistoryItem] = []
	@State private var password = ""
	@State private var confirmPassword = ""
	@State private var selectedBackend: String
	@State private var folderPath: String
	@State private var didSeedTransport = false
	@State private var isWorking = false
	@State private var localError: String?
	@State private var pendingDisable = false
	@State private var pendingRestore: ConfigSyncHistoryItem?

	init(
		client: TobyClient = TobyClient(),
		previewStatus: ConfigSyncStatus? = nil,
		previewHistory: [ConfigSyncHistoryItem] = []
	) {
		self.client = client
		self.previewStatus = previewStatus
		self.previewHistory = previewHistory
		_status = State(initialValue: previewStatus)
		_history = State(initialValue: previewHistory)
		_selectedBackend = State(initialValue: Self.initialBackend(previewStatus))
		_folderPath = State(initialValue: previewStatus?.folderPath ?? "")
		_didSeedTransport = State(initialValue: previewStatus != nil)
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 28) {
				VStack(alignment: .leading, spacing: 6) {
					Text("Sync")
						.font(.title2.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text(
						"Sync settings and credentials across your Macs through iCloud Drive or a folder you already replicate (Dropbox, Google Drive, NAS). The copy is encrypted with a password you choose. Chats, memories, recordings, skills, and schedules stay on this Mac."
					)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
				}

				if let message = statusBanner {
					InlineStatusMessage(
						message: message.text,
						tone: message.tone,
						font: .caption
					)
				}

				SettingsCard {
					SettingsRow(
						title: "Sync settings across Macs",
						description: transportDescription,
						showsDivider: !(resolvedStatus?.enabled ?? false)
					) {
						if resolvedStatus?.enabled == true {
							Button("Disable") { pendingDisable = true }
								.disabled(isWorking)
								.accessibilityIdentifier("icloud-sync-disable")
						} else {
							EmptyView()
						}
					}

					if resolvedStatus?.enabled != true {
						enableForm
					}
				}

				if resolvedStatus?.enabled == true {
					statusCard
					historyCard
				}

				inboundNote
			}
			.padding(24)
			.frame(maxWidth: SettingsDesign.contentMaxWidth, alignment: .leading)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.background(SettingsDesign.canvasBackground)
		.task {
			if previewStatus == nil {
				await refresh()
			}
		}
		.alert("Disable settings sync?", isPresented: $pendingDisable) {
			Button("Cancel", role: .cancel) { pendingDisable = false }
			Button("Disable", role: .destructive) {
				Task { await disable() }
			}
		} message: {
			Text("This Mac will stop uploading and downloading settings. The vault is left in place unless you delete it from the command line.")
		}
		.alert(
			"Restore this snapshot?",
			isPresented: Binding(
				get: { pendingRestore != nil },
				set: { if !$0 { pendingRestore = nil } }
			)
		) {
			Button("Cancel", role: .cancel) { pendingRestore = nil }
			Button("Restore") {
				if let item = pendingRestore {
					Task { await restore(item) }
				}
			}
		} message: {
			Text("This replaces settings on this Mac and uploads the snapshot as the current vault.")
		}
	}

	private var resolvedStatus: ConfigSyncStatus? {
		previewStatus ?? status
	}

	private var resolvedHistory: [ConfigSyncHistoryItem] {
		previewStatus == nil ? history : previewHistory
	}

	private var usingFolder: Bool {
		selectedBackend == "folder"
	}

	private var transportDescription: String {
		if resolvedStatus?.enabled == true {
			if resolvedStatus?.resolvedBackend == "folder" {
				return "This Mac uploads an encrypted snapshot after settings change and pulls updates from the chosen folder."
			}
			return "This Mac uploads an encrypted snapshot after settings change and pulls updates automatically."
		}
		if usingFolder {
			return "Choose a private folder you already sync to your other Macs. Toby writes an encrypted vault under Toby/config-sync inside it."
		}
		if resolvedStatus?.iCloudAvailable == false {
			return "Sign in to iCloud and turn on iCloud Drive in System Settings, or choose a folder instead."
		}
		if resolvedStatus?.hasRemote == true {
			return "An existing vault was found. Enter the password from your other Mac to join."
		}
		return "Choose a password you will remember. It is required on every Mac that joins."
	}

	private var statusBanner: (text: String, tone: InlineStatusTone)? {
		if let localError {
			return (localError, .error)
		}
		if let err = resolvedStatus?.lastError, !err.isEmpty {
			return (err, .error)
		}
		return nil
	}

	@ViewBuilder
	private var enableForm: some View {
		VStack(alignment: .leading, spacing: 12) {
			Picker("Transport", selection: $selectedBackend) {
				Text("iCloud Drive").tag("icloud")
				Text("Folder").tag("folder")
			}
			.pickerStyle(.segmented)
			.disabled(isWorking)
			.accessibilityIdentifier("icloud-sync-backend")

			if usingFolder {
				HStack(alignment: .center, spacing: 8) {
					Text(folderPath.isEmpty ? "No folder selected" : folderPath)
						.font(.caption)
						.foregroundStyle(folderPath.isEmpty ? AppTheme.secondaryText : AppTheme.primaryText)
						.lineLimit(1)
						.truncationMode(.middle)
						.frame(maxWidth: .infinity, alignment: .leading)
						.help(folderPath)
						.accessibilityIdentifier("icloud-sync-folder-path")
					Button("Choose…") { presentFolderChooser() }
						.disabled(isWorking)
						.accessibilityIdentifier("icloud-sync-choose-folder")
				}
			}

			SecureField("Sync password", text: $password)
				.textFieldStyle(.roundedBorder)
				.disabled(isWorking)
				.accessibilityIdentifier("icloud-sync-password")
			SecureField("Confirm password", text: $confirmPassword)
				.textFieldStyle(.roundedBorder)
				.disabled(isWorking)
				.accessibilityIdentifier("icloud-sync-password-confirm")
			HStack {
				Spacer()
				Button(enableButtonTitle) {
					Task { await enable() }
				}
				.disabled(!canEnable)
				.accessibilityIdentifier("icloud-sync-enable")
			}
		}
		.padding(14)
	}

	private var enableButtonTitle: String {
		resolvedStatus?.hasRemote == true ? "Join vault" : "Enable sync"
	}

	private var canEnable: Bool {
		guard !isWorking else { return false }
		let trimmed = password.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty, trimmed == confirmPassword else { return false }
		if usingFolder {
			return !folderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		}
		return resolvedStatus?.iCloudAvailable != false
	}

	private var statusCard: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				SettingsSectionHeader(title: "Status")
				if let status = resolvedStatus {
					statusLine(
						"Transport",
						status.resolvedBackend == "folder" ? "Folder" : "iCloud Drive"
					)
					if let folder = status.folderPath, !folder.isEmpty {
						statusLine("Folder", folder)
					}
					statusLine("This Mac", status.deviceName)
					if let writer = status.lastWriterDeviceName {
						statusLine("Last writer", writer)
					}
					if let push = status.lastPushAt {
						statusLine("Last push", push)
					}
					if let pull = status.lastPullAt {
						statusLine("Last pull", pull)
					}
				}
				HStack {
					Button("Sync now") { Task { await push() } }
						.disabled(isWorking)
						.accessibilityIdentifier("icloud-sync-push")
					Button("Pull now") { Task { await pull() } }
						.disabled(isWorking)
						.accessibilityIdentifier("icloud-sync-pull")
					Spacer()
				}
			}
			.padding(14)
		}
	}

	private var historyCard: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				SettingsSectionHeader(title: "History")
				if resolvedHistory.isEmpty {
					Text("No previous snapshots yet.")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				} else {
					ForEach(resolvedHistory) { item in
						HStack {
							VStack(alignment: .leading, spacing: 2) {
								Text(item.clock.deviceName)
									.font(.system(size: 13, weight: .semibold))
									.foregroundStyle(SettingsDesign.rowTitle)
								Text(item.createdAt)
									.font(.caption)
									.foregroundStyle(SettingsDesign.rowDescription)
							}
							Spacer()
							Button("Restore") { pendingRestore = item }
								.disabled(isWorking)
						}
					}
				}
			}
			.padding(14)
		}
	}

	private var inboundNote: some View {
		Text(
			"If you use inbound Slack chat, enable the inbound listener on only one Mac. Sharing tokens is fine; two daemons should not both listen."
		)
		.font(.caption)
		.foregroundStyle(AppTheme.secondaryText)
		.fixedSize(horizontal: false, vertical: true)
	}

	private func statusLine(_ title: String, _ value: String) -> some View {
		HStack {
			Text(title)
				.font(.subheadline)
				.foregroundStyle(AppTheme.secondaryText)
			Spacer()
			Text(value)
				.font(.subheadline)
				.foregroundStyle(AppTheme.primaryText)
				.textSelection(.enabled)
				.lineLimit(1)
				.truncationMode(.middle)
		}
	}

	private func presentFolderChooser() {
		let panel = NSOpenPanel()
		panel.canChooseFiles = false
		panel.canChooseDirectories = true
		panel.canCreateDirectories = true
		panel.allowsMultipleSelection = false
		if !folderPath.isEmpty {
			panel.directoryURL = URL(fileURLWithPath: folderPath)
		}
		panel.prompt = "Choose"
		panel.message = "Choose a private folder you already sync to your other Macs."
		guard panel.runModal() == .OK, let url = panel.url else { return }
		folderPath = url.path
	}

	private func enable() async {
		let trimmed = password.trimmingCharacters(in: .whitespacesAndNewlines)
		guard trimmed == confirmPassword.trimmingCharacters(in: .whitespacesAndNewlines) else {
			localError = "Passwords do not match."
			return
		}
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			let mode = resolvedStatus?.hasRemote == true ? "join" : "create"
			let path = folderPath.trimmingCharacters(in: .whitespacesAndNewlines)
			status = try await client.enableConfigSync(
				password: trimmed,
				mode: mode,
				backend: selectedBackend,
				folderPath: usingFolder ? path : nil
			)
			password = ""
			confirmPassword = ""
			await loadHistory()
		} catch {
			localError = error.localizedDescription
		}
	}

	private func disable() async {
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			status = try await client.disableConfigSync()
			history = []
		} catch {
			localError = error.localizedDescription
		}
	}

	private func push() async {
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			try await client.pushConfigSync()
			await refresh()
		} catch {
			localError = error.localizedDescription
		}
	}

	private func pull() async {
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			try await client.pullConfigSync()
			await refresh()
		} catch {
			localError = error.localizedDescription
		}
	}

	private func restore(_ item: ConfigSyncHistoryItem) async {
		pendingRestore = nil
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			try await client.restoreConfigSyncHistory(filename: item.filename)
			await refresh()
		} catch {
			localError = error.localizedDescription
		}
	}

	private func refresh() async {
		do {
			let next = try await client.fetchConfigSyncStatus()
			applyFetchedStatus(next)
			await loadHistory()
			localError = nil
		} catch {
			localError = error.localizedDescription
		}
	}

	private func applyFetchedStatus(_ next: ConfigSyncStatus) {
		status = next
		if !didSeedTransport {
			selectedBackend = Self.initialBackend(next)
			if let path = next.folderPath, !path.isEmpty {
				folderPath = path
			}
			didSeedTransport = true
		} else if next.enabled {
			selectedBackend = next.resolvedBackend
			if let path = next.folderPath, !path.isEmpty {
				folderPath = path
			}
		}
	}

	private func loadHistory() async {
		guard resolvedStatus?.enabled == true else {
			history = []
			return
		}
		history = (try? await client.listConfigSyncHistory()) ?? []
	}

	private static func initialBackend(_ status: ConfigSyncStatus?) -> String {
		if let backend = status?.backend, backend == "folder" {
			return "folder"
		}
		if status?.iCloudAvailable == false {
			return "folder"
		}
		return "icloud"
	}
}
