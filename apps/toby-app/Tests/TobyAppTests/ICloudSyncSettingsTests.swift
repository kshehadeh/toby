import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ICloudSyncSettings")
struct ICloudSyncSettingsTests {
	@Test("iCloud section has correct key and label")
	func iCloudSectionProperties() {
		let section = SettingsItem.iCloudSection
		#expect(section.key == SettingsItem.iCloudSectionKey)
		#expect(section.label == "Sync")
		#expect(section.kind == .section)
		#expect(section.navKey == SettingsItem.iCloudSectionKey)
		#expect(SettingsItem.iCloudSectionKey == "icloud")
		#expect(SettingsSidebarIcon.systemName(for: section) == "arrow.triangle.2.circlepath")
	}

	@Test("iCloud tab is a client-only settings tab")
	func iCloudIsClientOnlyTab() {
		#expect(
			RootSettingsNavigation.clientOnlySettingsTabKeys.contains(
				SettingsItem.iCloudSectionKey
			)
		)
	}

	@Test("settings view offers a folder when Drive is unavailable")
	func folderOfferedWhenDriveUnavailable() throws {
		let status = ConfigSyncStatus(
			enabled: false,
			iCloudAvailable: false,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 0,
			lastAckedContentHash: "",
			dirty: false,
			hasRemote: false,
			remote: nil
		)
		let view = ICloudSyncSettingsView(previewStatus: status)
		let title = try view.inspect().find(text: "Sync and Backup")
		#expect(try title.string() == "Sync and Backup")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-enable")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-backend")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-choose-folder")
		_ = try view.inspect().find(text: "Choose a private folder you already sync to your other Macs. Toby writes an encrypted copy under Toby/sync inside it.")
	}

	@Test("folder path preview still shows enable when Drive is unavailable")
	func folderPathDoesNotRequireICloud() throws {
		let status = ConfigSyncStatus(
			enabled: false,
			iCloudAvailable: false,
			backend: "folder",
			folderPath: "/tmp/dropbox",
			storeAvailable: true,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/dropbox/Toby/sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 0,
			lastAckedContentHash: "",
			dirty: false,
			hasRemote: false,
			remote: nil
		)
		let view = ICloudSyncSettingsView(previewStatus: status)
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-enable")
		_ = try view.inspect().find(text: "/tmp/dropbox")
		_ = try view.inspect().find(text: "Enable sync")
	}

	@Test("same folder with an existing vault shows join")
	func matchingFolderShowsJoin() throws {
		let status = ConfigSyncStatus(
			enabled: false,
			iCloudAvailable: false,
			backend: "folder",
			folderPath: "/tmp/dropbox",
			storeAvailable: true,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/dropbox/Toby/sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 0,
			lastAckedContentHash: "",
			dirty: false,
			hasRemote: true,
			remote: nil
		)
		let view = ICloudSyncSettingsView(previewStatus: status)
		_ = try view.inspect().find(text: "Join vault")
	}

	@Test("stale hasRemote does not force join when no folder is selected")
	func staleRemoteShowsEnableSync() throws {
		let status = ConfigSyncStatus(
			enabled: false,
			iCloudAvailable: false,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 0,
			lastAckedContentHash: "",
			dirty: false,
			hasRemote: true,
			remote: nil
		)
		let view = ICloudSyncSettingsView(previewStatus: status)
		_ = try view.inspect().find(text: "Enable sync")
	}

	@Test("enabled settings pane shows sync now and collapsed status")
	func enabledShowsSyncActions() throws {
		let status = ConfigSyncStatus(
			enabled: true,
			iCloudAvailable: true,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: "2026-08-21T00:00:00.000Z",
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: "Test Mac",
			lastWriterDeviceId: "test-device",
			lastAckedLamport: 1,
			lastAckedContentHash: "abc",
			dirty: false,
			hasRemote: true,
			remote: nil
		)
		let view = ICloudSyncSettingsView(previewStatus: status)
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-pane")
		_ = try view.inspect().find(text: "Settings")
		_ = try view.inspect().find(text: "Data")
		_ = try view.inspect().find(text: "Sync and Backup")
		_ = try view.inspect().find(text: "Status")
		_ = try view.inspect().find(text: "History")
		_ = try view.inspect().find(text: "Previous copies of settings and credentials. Toby keeps the latest 3. Restore does not change chats, projects, or recordings.")
		_ = try view.inspect().find(text: "Sync Settings Now")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-push")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-disable")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-status")
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-enabled")
		}
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(text: "Download settings")
		}
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-pull")
		}
	}

	@Test("expanded status shows last uploaded time")
	func expandedStatusShowsDetails() throws {
		let status = ConfigSyncStatus(
			enabled: true,
			iCloudAvailable: true,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: "2026-08-21T00:00:00.000Z",
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: "Test Mac",
			lastWriterDeviceId: "test-device",
			lastAckedLamport: 1,
			lastAckedContentHash: "abc",
			dirty: false,
			hasRemote: true,
			remote: nil
		)
		let view = ICloudSyncSettingsView(
			previewStatus: status,
			previewStatusExpanded: true
		)
		_ = try view.inspect().find(text: "Last uploaded")
		_ = try view.inspect().find(text: "Last writer")
		_ = try view.inspect().find(text: "Location")
		_ = try view.inspect().find(text: "/tmp/toby-sync")
	}

	@Test("database backup identities include device and filename")
	func databaseBackupIdentitiesAreUnique() {
		let first = DatabaseSyncBackup(
			filename: "2026-09-09T09-22-56-736Z.tbybak",
			deviceId: "dev-1",
			deviceName: "UA1GHWQ32M2NF",
			createdAt: "2026-09-09T09:22:56.736Z"
		)
		let second = DatabaseSyncBackup(
			filename: "2026-09-08T10-30-17-678Z.tbybak",
			deviceId: "dev-1",
			deviceName: "UA1GHWQ32M2NF",
			createdAt: "2026-09-08T10:30:17.678Z"
		)
		#expect(first.id == "dev-1/2026-09-09T09-22-56-736Z.tbybak")
		#expect(second.id == "dev-1/2026-09-08T10-30-17-678Z.tbybak")
		#expect(first.id != second.id)
	}

	@Test("database backup list renders each snapshot instead of repeating one")
	func databaseBackupListShowsDistinctSnapshots() throws {
		let status = ConfigSyncStatus(
			enabled: true,
			iCloudAvailable: true,
			deviceId: "dev-1",
			deviceName: "UA1GHWQ32M2NF",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 1,
			lastAckedContentHash: "abc",
			dirty: false,
			hasRemote: true,
			remote: nil,
			databaseBackupsEnabled: true
		)
		let firstCreated = "2026-09-09T09:22:56.736Z"
		let secondCreated = "2026-09-08T10:30:17.678Z"
		let backups = [
			DatabaseSyncBackup(
				filename: "2026-09-09T09-22-56-736Z.tbybak",
				deviceId: "dev-1",
				deviceName: "UA1GHWQ32M2NF",
				createdAt: firstCreated,
				path: "/tmp/toby-sync/data-backups/dev-1/2026-09-09T09-22-56-736Z.tbybak",
				includesProjects: true,
				includesRecordings: true
			),
			DatabaseSyncBackup(
				filename: "2026-09-08T10-30-17-678Z.tbybak",
				deviceId: "dev-1",
				deviceName: "UA1GHWQ32M2NF",
				createdAt: secondCreated,
				path: "/tmp/toby-sync/data-backups/dev-1/2026-09-08T10-30-17-678Z.tbybak",
				includesProjects: true,
				includesRecordings: true
			),
		]
		let view = ICloudSyncSettingsView(
			previewStatus: status,
			previewDatabaseBackups: backups,
			previewSelectedPane: .dataBackups
		)
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-pane")
		_ = try view.inspect().find(text: "UA1GHWQ32M2NF")
		_ = try view.inspect().find(text: SyncTimestampFormatting.displayString(fromISO: firstCreated))
		_ = try view.inspect().find(text: SyncTimestampFormatting.displayString(fromISO: secondCreated))
		_ = try view.inspect().find(text: "Chats, projects, and recordings")
		_ = try view.inspect().find(text: "History")
		_ = try view.inspect().find(
			text: "Previous copies of chats, projects, and recordings. Toby keeps the latest 3 per Mac. Restore replaces that data on this Mac and restarts Toby."
		)
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-enabled")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-disable")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-status")
		_ = try view.inspect().find(text: "Back Up Now")
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-push")
		}
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "database-backup-2026-09-09T09-22-56-736Z.tbybak")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "database-backup-2026-09-08T10-30-17-678Z.tbybak")
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(text: firstCreated)
		}
	}

	@Test("expanded data status shows backup folder and last backup")
	func expandedDataStatusShowsDetails() throws {
		let lastBackup = "2026-09-09T09:22:56.736Z"
		let status = ConfigSyncStatus(
			enabled: true,
			iCloudAvailable: true,
			deviceId: "dev-1",
			deviceName: "UA1GHWQ32M2NF",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 1,
			lastAckedContentHash: "abc",
			dirty: false,
			hasRemote: true,
			remote: nil,
			databaseBackupsEnabled: true,
			lastDatabaseBackupAt: lastBackup
		)
		let backups = [
			DatabaseSyncBackup(
				filename: "2026-09-09T09-22-56-736Z.tbybak",
				deviceId: "dev-1",
				deviceName: "UA1GHWQ32M2NF",
				createdAt: lastBackup,
				path: "/tmp/toby-sync/data-backups/dev-1/2026-09-09T09-22-56-736Z.tbybak",
				includesProjects: true,
				includesRecordings: true
			),
		]
		let view = ICloudSyncSettingsView(
			previewStatus: status,
			previewDatabaseBackups: backups,
			previewSelectedPane: .dataBackups,
			previewStatusExpanded: true
		)
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-status")
		_ = try view.inspect().find(text: "Daily backups")
		_ = try view.inspect().find(text: "On")
		_ = try view.inspect().find(text: "Last backup")
		_ = try view.inspect().find(text: "Folder")
		_ = try view.inspect().find(text: "/tmp/toby-sync/data-backups/dev-1")
		_ = try view.inspect().find(text: "1 of 3")
	}

	@Test("sync timestamps format as local date and time")
	func syncTimestampsUseFormattedDates() {
		let iso = "2026-09-09T09:22:56.736Z"
		let formatted = SyncTimestampFormatting.displayString(fromISO: iso)
		#expect(formatted != iso)
		#expect(SyncTimestampFormatting.date(fromISO: iso) != nil)
	}

	@Test("configuration backups list shows only the latest three")
	func configurationBackupsListShowsLatestThree() throws {
		let status = ConfigSyncStatus(
			enabled: true,
			iCloudAvailable: true,
			deviceId: "dev-1",
			deviceName: "Test Mac",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 1,
			lastAckedContentHash: "abc",
			dirty: false,
			hasRemote: true,
			remote: nil
		)
		let history = [
			makeHistoryItem(filename: "one.json", deviceName: "Mac One", createdAt: "2026-09-09T09:00:00.000Z"),
			makeHistoryItem(filename: "two.json", deviceName: "Mac Two", createdAt: "2026-09-08T09:00:00.000Z"),
			makeHistoryItem(filename: "three.json", deviceName: "Mac Three", createdAt: "2026-09-07T09:00:00.000Z"),
			makeHistoryItem(filename: "four.json", deviceName: "Mac Four", createdAt: "2026-09-06T09:00:00.000Z"),
		]
		let view = ICloudSyncSettingsView(
			previewStatus: status,
			previewHistory: history
		)
		_ = try view.inspect().find(text: "History")
		_ = try view.inspect().find(text: "Settings and credentials")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "sync-history-one.json")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "sync-history-two.json")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "sync-history-three.json")
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "sync-history-four.json")
		}
		_ = try view.inspect().find(text: "Mac One")
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(text: "Mac Four")
		}
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-enabled")
		}
	}

	@Test("data backups pane asks to enable settings sync first")
	func dataPaneRequiresConfigurationSync() throws {
		let status = ConfigSyncStatus(
			enabled: false,
			iCloudAvailable: true,
			deviceId: "test-device",
			deviceName: "Test Mac",
			vaultPath: "/tmp/toby-sync",
			lastPushAt: nil,
			lastPullAt: nil,
			lastError: nil,
			lastWriterDeviceName: nil,
			lastWriterDeviceId: nil,
			lastAckedLamport: 0,
			lastAckedContentHash: "",
			dirty: false,
			hasRemote: false,
			remote: nil
		)
		let view = ICloudSyncSettingsView(
			previewStatus: status,
			previewSelectedPane: .dataBackups
		)
		_ = try view.inspect().find(
			text: "Data backups use the same encrypted folder as settings sync. Enable settings sync first."
		)
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-data-requires-configuration")
		#expect(throws: (any Error).self) {
			_ = try view.inspect().find(viewWithAccessibilityIdentifier: "data-backups-enabled")
		}
	}

	private func makeHistoryItem(
		filename: String,
		deviceName: String,
		createdAt: String
	) -> ConfigSyncHistoryItem {
		ConfigSyncHistoryItem(
			filename: filename,
			createdAt: createdAt,
			contentHash: "hash-\(filename)",
			clock: ConfigSyncClock(
				lamport: 1,
				utc: createdAt,
				deviceId: "dev-1",
				deviceName: deviceName
			),
			path: "/tmp/toby-sync/settings-history/\(filename)"
		)
	}
}

@MainActor
@Suite("NativeICloudHandler")
struct NativeICloudHandlerTests {
	@Test("legacy config-sync folder is renamed to sync settings layout")
	func migratesLegacyConfigSyncFolder() throws {
		let parent = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		let legacy = parent.appendingPathComponent("Toby/config-sync")
		try FileManager.default.createDirectory(at: legacy.appendingPathComponent("history"), withIntermediateDirectories: true)
		try FileManager.default.createDirectory(at: legacy.appendingPathComponent("database-backups/dev-1"), withIntermediateDirectories: true)
		try Data("{}".utf8).write(to: legacy.appendingPathComponent("vault.json"))
		try Data("{}".utf8).write(to: legacy.appendingPathComponent("history/old.json"))
		try Data("x".utf8).write(to: legacy.appendingPathComponent("database-backups/dev-1/snap.tbybak"))
		defer { try? FileManager.default.removeItem(at: parent) }

		let migrated = NativeICloudHandler.migrateLegacyLayout(at: parent.appendingPathComponent("Toby/sync"))
		#expect(migrated.lastPathComponent == "sync")
		#expect(FileManager.default.fileExists(atPath: migrated.appendingPathComponent("settings.json").path))
		#expect(FileManager.default.fileExists(atPath: migrated.appendingPathComponent("settings-history/old.json").path))
		#expect(FileManager.default.fileExists(atPath: migrated.appendingPathComponent("data-backups/dev-1/snap.tbybak").path))
		#expect(!FileManager.default.fileExists(atPath: legacy.path))
	}

	@Test("status reports injected root as available")
	func statusWithOverride() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		NativeICloudHandler.rootOverride = dir
		defer {
			NativeICloudHandler.rootOverride = nil
			try? FileManager.default.removeItem(at: dir)
		}
		let data = NativeICloudHandler.status()
		let json = try decodeObject(data)
		#expect(json["ok"] as? Bool == true)
		let payload = json["data"] as? [String: Any]
		#expect(payload?["available"] as? Bool == true)
		#expect((payload?["vaultPath"] as? String)?.contains(dir.path) == true)
	}

	@Test("write then read round-trips an envelope")
	func writeReadRoundTrip() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		NativeICloudHandler.rootOverride = dir
		defer {
			NativeICloudHandler.rootOverride = nil
			try? FileManager.default.removeItem(at: dir)
		}
		let envelope: [String: Any] = [
			"version": 1,
			"format": "toby.config.sync.encrypted",
			"contentHash": "abc",
			"createdAt": "2026-08-21T00:00:00.000Z",
			"ciphertext": "dGVzdA==",
			"clock": [
				"lamport": 1,
				"utc": "2026-08-21T00:00:00.000Z",
				"deviceId": "dev",
				"deviceName": "Mac",
			],
			"encryption": [
				"cipher": "aes-256-gcm",
				"kdf": "scrypt",
				"n": 1,
				"r": 1,
				"p": 1,
				"keyLength": 32,
				"salt": "cw==",
				"iv": "aQ==",
				"authTag": "dA==",
			],
		]
		let writeBody = try JSONSerialization.data(withJSONObject: ["envelope": envelope])
		let written = NativeICloudHandler.write(body: writeBody)
		let writeJSON = try decodeObject(written)
		#expect(writeJSON["ok"] as? Bool == true)

		let readBody = try JSONSerialization.data(withJSONObject: ["filename": "settings.json"])
		let read = NativeICloudHandler.read(body: readBody)
		let readJSON = try decodeObject(read)
		#expect(readJSON["ok"] as? Bool == true)
		let data = readJSON["data"] as? [String: Any]
		let got = data?["envelope"] as? [String: Any]
		#expect(got?["contentHash"] as? String == "abc")
	}

	private func decodeObject(_ data: Data) throws -> [String: Any] {
		guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			throw TestFailure("expected JSON object")
		}
		return json
	}
}

private struct TestFailure: Error {
	let message: String
	init(_ message: String) { self.message = message }
}
