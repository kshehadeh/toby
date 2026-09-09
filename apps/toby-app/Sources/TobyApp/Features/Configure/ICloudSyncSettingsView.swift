import AppKit
import SwiftUI

enum SyncSettingsPane: String, CaseIterable, Identifiable {
	case settings
	case dataBackups

	var id: String { rawValue }

	var title: String {
		switch self {
		case .settings: return "Settings"
		case .dataBackups: return "Data"
		}
	}
}

/// Client-orchestrated settings sync tab. Crypto and apply/restore live
/// in the daemon; this view only drives `/api/config/sync*`.
struct ICloudSyncSettingsView: View {
	var client: TobyClient = TobyClient()
	/// When set, skip network fetches (previews and ViewInspector tests).
	var previewStatus: ConfigSyncStatus? = nil
	var previewHistory: [ConfigSyncHistoryItem] = []
	var previewDatabaseBackups: [DatabaseSyncBackup] = []
	var previewSelectedPane: SyncSettingsPane = .settings
	var previewStatusExpanded: Bool = false

	@State private var selectedPane: SyncSettingsPane
	@State private var statusExpanded: Bool
	@State private var dataStatusExpanded: Bool
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
	@State private var pendingDisableDataBackups = false
	@State private var pendingRestore: ConfigSyncHistoryItem?
	@State private var databaseBackups: [DatabaseSyncBackup] = []
	@State private var pendingDatabaseRestore: DatabaseSyncBackup?

	init(
		client: TobyClient = TobyClient(),
		previewStatus: ConfigSyncStatus? = nil,
		previewHistory: [ConfigSyncHistoryItem] = [],
		previewDatabaseBackups: [DatabaseSyncBackup] = [],
		previewSelectedPane: SyncSettingsPane = .settings,
		previewStatusExpanded: Bool = false
	) {
		self.client = client
		self.previewStatus = previewStatus
		self.previewHistory = previewHistory
		self.previewDatabaseBackups = previewDatabaseBackups
		self.previewSelectedPane = previewSelectedPane
		self.previewStatusExpanded = previewStatusExpanded
		_selectedPane = State(initialValue: previewSelectedPane)
		_statusExpanded = State(initialValue: previewStatusExpanded)
		_dataStatusExpanded = State(initialValue: previewStatusExpanded)
		_status = State(initialValue: previewStatus)
		_history = State(initialValue: previewHistory)
		_databaseBackups = State(initialValue: previewDatabaseBackups)
		_selectedBackend = State(initialValue: Self.initialBackend(previewStatus))
		_folderPath = State(initialValue: previewStatus?.folderPath ?? "")
		_didSeedTransport = State(initialValue: previewStatus != nil)
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 28) {
				VStack(alignment: .leading, spacing: 6) {
					Text("Sync and Backup")
						.font(.title2.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text(paneIntro)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.fixedSize(horizontal: false, vertical: true)
				}

				panePicker

				if let message = statusBanner {
					InlineStatusMessage(
						message: message.text,
						tone: message.tone,
						font: .caption
					)
				}

				switch selectedPane {
				case .settings:
					settingsPane
				case .dataBackups:
					dataPane
				}
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
			"Stop automatic data backups?",
			isPresented: $pendingDisableDataBackups
		) {
			Button("Cancel", role: .cancel) { pendingDisableDataBackups = false }
			Button("Disable") {
				Task { await setDatabaseBackups(false) }
			}
		} message: {
			Text("Toby will stop creating daily data backups. Existing backups remain.")
		}
		.alert(
			"Restore this settings backup?",
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
			Text("This replaces settings and credentials on this Mac and uploads them as the current copy. Chats, projects, and recordings are not changed.")
		}
		.alert(
			"Restore this data backup?",
			isPresented: Binding(
				get: { pendingDatabaseRestore != nil },
				set: { if !$0 { pendingDatabaseRestore = nil } }
			)
		) {
			Button("Cancel", role: .cancel) { pendingDatabaseRestore = nil }
			Button("Restore", role: .destructive) {
				if let backup = pendingDatabaseRestore {
					Task { await restoreDatabase(backup) }
				}
			}
		} message: {
			Text("This replaces chats, projects, project files, schedules, flows, run history, memories, and recordings on this Mac. Settings and credentials are not changed. Project folders are restored inside Toby's data folder. Toby will restart.")
		}
	}

	private var resolvedStatus: ConfigSyncStatus? {
		previewStatus ?? status
	}

	private var resolvedHistory: [ConfigSyncHistoryItem] {
		previewStatus == nil ? history : previewHistory
	}

	private var resolvedDatabaseBackups: [DatabaseSyncBackup] {
		previewStatus == nil ? databaseBackups : previewDatabaseBackups
	}

	private var displayedHistory: [ConfigSyncHistoryItem] {
		Array(resolvedHistory.prefix(Self.backupListLimit))
	}

	private var displayedDatabaseBackups: [DatabaseSyncBackup] {
		Array(resolvedDatabaseBackups.prefix(Self.backupListLimit))
	}

	private static let backupListLimit = 3

	private var usingFolder: Bool {
		selectedBackend == "folder"
	}

	private var paneIntro: String {
		switch selectedPane {
		case .settings:
			return "Share settings and credentials across your Macs through iCloud Drive or a folder you already replicate (Dropbox, Google Drive, NAS). The copy is encrypted with a password you choose."
		case .dataBackups:
			return "Save encrypted snapshots of chats, projects, and recordings — including audio and transcripts. These do not sync automatically. Toby keeps the latest 3 per Mac."
		}
	}

	private var panePicker: some View {
		Picker("Section", selection: $selectedPane) {
			ForEach(SyncSettingsPane.allCases) { pane in
				Text(pane.title).tag(pane)
			}
		}
		.pickerStyle(.segmented)
		.labelsHidden()
		.accessibilityIdentifier("icloud-sync-pane")
	}

	private var settingsPane: some View {
		VStack(alignment: .leading, spacing: 28) {
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
				settingsHistoryCard
				paneAction(
					title: "Sync Settings Now",
					help: "Send this Mac’s settings and credentials to iCloud Drive or your chosen folder.",
					identifier: "icloud-sync-push"
				) {
					Task { await push() }
				}
			}

			inboundNote
		}
	}

	@ViewBuilder
	private var dataPane: some View {
		if resolvedStatus?.enabled == true {
			VStack(alignment: .leading, spacing: 28) {
				SettingsCard {
					SettingsRow(
						title: "Back up this Mac’s chats, projects, and recordings daily",
						description: dataBackupsDescription,
						showsDivider: false
					) {
						if resolvedStatus?.databaseBackupsEnabled == true {
							Button("Disable") { pendingDisableDataBackups = true }
								.disabled(isWorking)
								.accessibilityIdentifier("data-backups-disable")
						} else {
							Button("Enable") { Task { await setDatabaseBackups(true) } }
								.disabled(isWorking)
								.accessibilityIdentifier("data-backups-enable")
						}
					}
				}
				.accessibilityIdentifier("data-backups-enabled")

				dataStatusCard
				dataHistoryCard

				if resolvedStatus?.databaseBackupsEnabled == true {
					paneAction(
						title: "Back Up Now",
						help: "Create an encrypted data backup now.",
						identifier: "data-backups-create"
					) {
						Task { await createDatabaseBackup() }
					}
				}
			}
		} else {
			SettingsCard {
				VStack(alignment: .leading, spacing: 12) {
					Text("Data backups use the same encrypted folder as settings sync. Enable settings sync first.")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
						.fixedSize(horizontal: false, vertical: true)
					Button("Set up settings sync") {
						selectedPane = .settings
					}
					.accessibilityIdentifier("icloud-sync-data-requires-configuration")
				}
				.padding(14)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
	}

	private var dataBackupsDescription: String {
		if resolvedStatus?.databaseBackupsEnabled == true {
			if let last = resolvedStatus?.lastDatabaseBackupAt {
				return "Last backup: \(SyncTimestampFormatting.displayString(fromISO: last))"
			}
			return "Toby keeps the latest 3 backups per Mac."
		}
		return "Encrypted snapshots stay in the same folder as settings sync. Existing backups remain if you disable this later."
	}

	private func paneAction(
		title: String,
		help: String,
		identifier: String,
		action: @escaping () -> Void
	) -> some View {
		HStack {
			Button(title, action: action)
				.disabled(isWorking)
				.help(help)
				.accessibilityIdentifier(identifier)
			Spacer()
		}
	}

	private var transportDescription: String {
		if resolvedStatus?.enabled == true {
			if resolvedStatus?.resolvedBackend == "folder" {
				return "This Mac uploads an encrypted snapshot after settings change and pulls updates from the chosen folder."
			}
			return "This Mac uploads an encrypted snapshot after settings change and pulls updates automatically."
		}
		if usingFolder {
			return "Choose a private folder you already sync to your other Macs. Toby writes an encrypted copy under Toby/sync inside it."
		}
		if resolvedStatus?.iCloudAvailable == false {
			return "Sign in to iCloud and turn on iCloud Drive in System Settings, or choose a folder instead."
		}
		if joiningExistingVault {
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
					if folderPath.isEmpty {
						Text("No folder selected")
							.font(.caption)
							.foregroundStyle(AppTheme.secondaryText)
							.frame(maxWidth: .infinity, alignment: .leading)
							.accessibilityIdentifier("icloud-sync-folder-path")
					} else {
						clickablePath(folderPath, identifier: "icloud-sync-folder-path")
							.frame(maxWidth: .infinity, alignment: .leading)
					}
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
		joiningExistingVault ? "Join vault" : "Enable sync"
	}

	/// `hasRemote` is for the store currently in sync-state, not a newly picked folder.
	private var joiningExistingVault: Bool {
		guard resolvedStatus?.hasRemote == true else { return false }
		if usingFolder {
			let picked = standardizedPath(folderPath)
			let current = standardizedPath(resolvedStatus?.folderPath ?? "")
			return !picked.isEmpty && picked == current
		}
		return selectedBackend == "icloud"
	}

	private func standardizedPath(_ path: String) -> String {
		let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return "" }
		return URL(fileURLWithPath: trimmed).standardizedFileURL.path
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
		collapsibleStatus(isExpanded: $statusExpanded, identifier: "icloud-sync-status") {
			if let status = resolvedStatus {
				statusLine(
					"Transport",
					status.resolvedBackend == "folder" ? "Folder" : "iCloud Drive"
				)
				if let folder = status.folderPath, !folder.isEmpty {
					statusPathLine("Folder", folder)
				}
				if !status.vaultPath.isEmpty {
					statusPathLine("Location", status.vaultPath)
				}
				statusLine("This Mac", status.deviceName)
				if let writer = status.lastWriterDeviceName {
					statusLine("Last writer", writer)
				}
				if let push = status.lastPushAt {
					statusLine("Last uploaded", SyncTimestampFormatting.displayString(fromISO: push))
				}
				if let pull = status.lastPullAt {
					statusLine("Last downloaded", SyncTimestampFormatting.displayString(fromISO: pull))
				}
			}
		}
	}

	private var dataStatusCard: some View {
		collapsibleStatus(isExpanded: $dataStatusExpanded, identifier: "data-backups-status") {
			if let status = resolvedStatus {
				statusLine(
					"Transport",
					status.resolvedBackend == "folder" ? "Folder" : "iCloud Drive"
				)
				if let folder = dataBackupFolderPath {
					statusPathLine("Folder", folder)
				}
				statusLine("This Mac", status.deviceName)
				statusLine(
					"Daily backups",
					status.databaseBackupsEnabled == true ? "On" : "Off"
				)
				if let last = status.lastDatabaseBackupAt {
					statusLine("Last backup", SyncTimestampFormatting.displayString(fromISO: last))
				}
				statusLine("Snapshots", "\(displayedDatabaseBackups.count) of \(Self.backupListLimit)")
			}
		}
	}

	private var dataBackupFolderPath: String? {
		if let filePath = displayedDatabaseBackups.first?.path, !filePath.isEmpty {
			return URL(fileURLWithPath: filePath).deletingLastPathComponent().path
		}
		let vault = resolvedStatus?.vaultPath ?? ""
		guard !vault.isEmpty else { return nil }
		return (vault as NSString).appendingPathComponent("data-backups")
	}

	private func collapsibleStatus<Content: View>(
		isExpanded: Binding<Bool>,
		identifier: String,
		@ViewBuilder content: () -> Content
	) -> some View {
		let details = content()
		return SettingsCard {
			DisclosureGroup(isExpanded: isExpanded) {
				VStack(alignment: .leading, spacing: 8) {
					details
				}
				.padding(.top, 8)
			} label: {
				Text("Status")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(SettingsDesign.sectionHeader)
			}
			.padding(14)
			.accessibilityIdentifier(identifier)
		}
	}

	private var settingsHistoryCard: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				SettingsSectionHeader(title: "History")
				Text("Previous copies of settings and credentials. Toby keeps the latest 3. Restore does not change chats, projects, or recordings.")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
				if displayedHistory.isEmpty {
					Text("No settings backups yet.")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				} else {
					ForEach(displayedHistory) { item in
						snapshotRow(
							title: item.clock.deviceName,
							timestamp: item.createdAt,
							subtitle: "Settings and credentials",
							path: item.path,
							accessibilityID: "sync-history-\(item.filename)",
							restore: { pendingRestore = item }
						)
					}
				}
			}
			.padding(14)
			.frame(maxWidth: .infinity, alignment: .topLeading)
		}
	}

	private var dataHistoryCard: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				SettingsSectionHeader(title: "History")
				Text("Previous copies of chats, projects, and recordings. Toby keeps the latest 3 per Mac. Restore replaces that data on this Mac and restarts Toby.")
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
				if displayedDatabaseBackups.isEmpty {
					Text("No data backups yet.")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				} else {
					ForEach(displayedDatabaseBackups) { backup in
						snapshotRow(
							title: backup.deviceName,
							timestamp: backup.createdAt,
							subtitle: backupContentsLabel(backup),
							path: backup.path,
							accessibilityID: "database-backup-\(backup.filename)",
							restore: { pendingDatabaseRestore = backup }
						)
					}
				}
				if let error = resolvedStatus?.lastDatabaseBackupError, !error.isEmpty {
					InlineStatusMessage(message: error, tone: .error, font: .caption)
				}
			}
			.padding(14)
			.frame(maxWidth: .infinity, alignment: .topLeading)
		}
	}

	private func backupContentsLabel(_ backup: DatabaseSyncBackup) -> String {
		let projects = backup.includesProjects == true
		let recordings = backup.includesRecordings == true
		if projects && recordings {
			return "Chats, projects, and recordings"
		}
		if projects {
			return "Chats and project files"
		}
		if recordings {
			return "Chats and recordings"
		}
		return "Chats and memories"
	}

	private func snapshotRow(
		title: String,
		timestamp: String,
		subtitle: String?,
		path: String?,
		accessibilityID: String,
		restore: @escaping () -> Void
	) -> some View {
		HStack(alignment: .center, spacing: 8) {
			Button {
				if let path, !path.isEmpty {
					RevealInFinder.reveal(path: path)
				}
			} label: {
				HStack(alignment: .center, spacing: 8) {
					Image(systemName: "folder")
						.font(.caption)
						.foregroundStyle(path?.isEmpty == false ? AppTheme.accent : AppTheme.tertiaryText)
						.accessibilityHidden(true)
					VStack(alignment: .leading, spacing: 2) {
						Text(title)
							.font(.system(size: 13, weight: .semibold))
							.foregroundStyle(SettingsDesign.rowTitle)
						Text(SyncTimestampFormatting.displayString(fromISO: timestamp))
							.font(.caption)
							.foregroundStyle(SettingsDesign.rowDescription)
						if let subtitle, !subtitle.isEmpty {
							Text(subtitle)
								.font(.caption)
								.foregroundStyle(SettingsDesign.rowDescription)
						}
					}
					Spacer(minLength: 0)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.disabled(path?.isEmpty != false)
			.help(path?.isEmpty == false ? "Show in Finder" : "Backup file is not available on this Mac")
			.accessibilityLabel("Show in Finder")
			.accessibilityValue("\(title), \(SyncTimestampFormatting.displayString(fromISO: timestamp))")
			Button("Restore") { restore() }
				.disabled(isWorking)
		}
		.accessibilityIdentifier(accessibilityID)
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

	private func statusPathLine(_ title: String, _ path: String) -> some View {
		HStack(alignment: .center, spacing: 8) {
			Text(title)
				.font(.subheadline)
				.foregroundStyle(AppTheme.secondaryText)
			Spacer(minLength: 8)
			clickablePath(path)
				.frame(maxWidth: 280, alignment: .trailing)
		}
	}

	private func clickablePath(_ path: String, identifier: String? = nil) -> some View {
		Button {
			RevealInFinder.reveal(path: path)
		} label: {
			HStack(spacing: 4) {
				Image(systemName: "folder")
					.font(.caption)
					.foregroundStyle(AppTheme.accent)
					.accessibilityHidden(true)
				Text(path)
					.font(.subheadline)
					.foregroundStyle(AppTheme.accent)
					.lineLimit(1)
					.truncationMode(.middle)
			}
		}
		.buttonStyle(.plain)
		.help("Show in Finder")
		.accessibilityLabel("Show in Finder")
		.accessibilityValue(path)
		.accessibilityIdentifier(identifier ?? "sync-folder-\(path)")
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
			let path = folderPath.trimmingCharacters(in: .whitespacesAndNewlines)
			status = try await client.enableConfigSync(
				password: trimmed,
				mode: usingFolder ? nil : (joiningExistingVault ? "join" : "create"),
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

	private func setDatabaseBackups(_ enabled: Bool) async {
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			status = try await client.setDatabaseBackupsEnabled(enabled)
			await loadDatabaseBackups()
		} catch {
			localError = error.localizedDescription
		}
	}

	private func createDatabaseBackup() async {
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			try await client.createDatabaseBackupNow()
			await refresh()
		} catch {
			localError = error.localizedDescription
		}
	}

	private func restoreDatabase(_ backup: DatabaseSyncBackup) async {
		pendingDatabaseRestore = nil
		isWorking = true
		localError = nil
		defer { isWorking = false }
		do {
			try await client.restoreDatabaseBackup(
				deviceId: backup.deviceId,
				filename: backup.filename
			)
		} catch {
			localError = error.localizedDescription
		}
	}

	private func refresh() async {
		do {
			let next = try await client.fetchConfigSyncStatus()
			applyFetchedStatus(next)
			await loadHistory()
			await loadDatabaseBackups()
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

	private func loadDatabaseBackups() async {
		guard resolvedStatus?.enabled == true else {
			databaseBackups = []
			return
		}
		databaseBackups = (try? await client.listDatabaseBackups()) ?? []
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

enum SyncTimestampFormatting {
	static func displayString(fromISO iso: String) -> String {
		guard let date = date(fromISO: iso) else { return iso }
		return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
	}

	static func date(fromISO iso: String) -> Date? {
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
	}
}
