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
		let title = try view.inspect().find(text: "Sync")
		#expect(try title.string() == "Sync")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-enable")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-backend")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-choose-folder")
		_ = try view.inspect().find(text: "Choose a private folder you already sync to your other Macs. Toby writes an encrypted vault under Toby/config-sync inside it.")
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
			vaultPath: "/tmp/dropbox/Toby/config-sync",
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
			vaultPath: "/tmp/dropbox/Toby/config-sync",
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

	@Test("enabled status shows sync now and pull now")
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
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-push")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-pull")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "icloud-sync-disable")
		_ = try view.inspect().find(viewWithAccessibilityIdentifier: "database-backups-enabled")
	}
}

@MainActor
@Suite("NativeICloudHandler")
struct NativeICloudHandlerTests {
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

		let readBody = try JSONSerialization.data(withJSONObject: ["filename": "vault.json"])
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
