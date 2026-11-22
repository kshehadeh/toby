import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
@testable import TobyStore

@Suite("Backups")
struct BackupTests {
	final class MemoryKey: APIKeyStore, @unchecked Sendable {
		var key: String?
		init(_ key: String?) { self.key = key }
		func read() throws -> String? { key }
		func save(_ key: String) throws { self.key = key }
	}

	let home: URL
	let paths: TobyPaths
	let database: TobyDatabase
	let secrets = InMemorySecretStore()

	init() throws {
		home = try temporaryHome()
		paths = TobyPaths(root: home)
		database = try TobyDatabase.open(paths: paths)
	}

	static func fixture(_ name: String) -> URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().appending(path: "Fixtures/\(name)") }

	@Test func roundTripsDatabaseFilesAndSettings() throws {
		let projectDir = home.appending(path: "custom/project-a")
		try FileManager.default.createDirectory(at: projectDir.appending(path: "outputs"), withIntermediateDirectories: true)
		try Data("report".utf8).write(to: projectDir.appending(path: "outputs/r.md"))
		let recording = paths.listenRecordings.appending(path: "rec1")
		try FileManager.default.createDirectory(at: recording, withIntermediateDirectories: true)
		try Data("audio".utf8).write(to: recording.appending(path: "combined.m4a"))
		try database.writer.write { db in
			try db.execute(sql: "INSERT INTO projects (id, slug, name, folder_path, created_at, updated_at) VALUES ('p1', 'a', 'A', ?, 'x', 'x')", arguments: [projectDir.path])
		}
		try Data(#"{"listen":{"deleteAudioAfterTranscription":false}}"#.utf8).write(to: paths.legacyConfig)
		try secrets.setSecret("pw", for: "mail.imapPassword")
		let key = MemoryKey("sk-or-1")
		let service = BackupService(paths: paths, writer: database.writer, secrets: secrets, openRouter: key)
		let file = home.appending(path: "out/b.tbybak")
		try service.create(password: "  s3cret ", to: file)
		#expect(BackupArchive.isArchive(file))
		#expect(throws: BackupArchive.Failure.self) { try service.restore(file: file, password: "wrong") }

		// Mutate, then restore into the same home.
		try database.writer.write { db in try db.execute(sql: "DELETE FROM projects") }
		try FileManager.default.removeItem(at: recording)
		try Data("{}".utf8).write(to: paths.legacyConfig)
		let staged = try service.restore(file: file, password: "s3cret")
		#expect(staged == .init(database: true, legacy: false, projects: true, recordings: true, library: true, settings: true))
		#expect(BackupService.hasPending(paths))

		let secrets2 = InMemorySecretStore()
		let key2 = MemoryKey(nil)
		let projects = try BackupService.applyPending(paths, secrets: secrets2, openRouter: key2)
		#expect(!BackupService.hasPending(paths))
		#expect(projects == ["p1"])
		#expect(try secrets2.secret("mail.imapPassword") == "pw")
		#expect(key2.key == "sk-or-1")
		#expect(try String(contentsOf: paths.legacyConfig, encoding: .utf8).contains("deleteAudioAfterTranscription"))
		#expect(FileManager.default.fileExists(atPath: paths.listenRecordings.appending(path: "rec1/combined.m4a").path))
		#expect(try String(contentsOf: paths.projects.appending(path: "p1/outputs/r.md"), encoding: .utf8) == "report")

		let reopened = try TobyDatabase.open(paths: paths)
		try BackupService.repointProjects(projects, writer: reopened.writer, projectsDir: paths.projects)
		let folder = try reopened.writer.read { db in try String.fetchOne(db, sql: "SELECT folder_path FROM projects WHERE id = 'p1'") }
		#expect(folder == paths.projects.appending(path: "p1").path)
	}

	@Test func readsADaemonArchive() throws {
		let service = BackupService(paths: paths, writer: database.writer, secrets: secrets, openRouter: nil)
		let staged = try service.restore(file: Self.fixture("ts-backup.tbybak"), password: "hunter2")
		#expect(staged.legacy && staged.database && staged.projects && staged.settings)
		#expect(!staged.recordings)
		try BackupService.applyPending(paths, secrets: secrets, openRouter: nil)
		#expect(try Data(contentsOf: paths.legacyChatDatabase) == Data("SQLite format 3\0fake-chat-bytes".utf8))
		#expect(try Data(contentsOf: paths.legacyMemoryDatabase) == Data("SQLite format 3\0fake-memory-bytes".utf8))
		#expect(!FileManager.default.fileExists(atPath: paths.database.path), "native DB set aside so the import re-runs")
		#expect(try String(contentsOf: paths.projects.appending(path: "p1/notes/f.txt"), encoding: .utf8) == "hello project")
		#expect(try secrets.secret("mail.imapPassword") == "pw", "legacy credentials map to secrets")
		let header = try BackupArchive.Reader.header(Self.fixture("ts-backup.tbybak")).header
		#expect(header["info"]?["deviceName"] == "TS Mac")
	}

	@Test func readsALegacyJSONBackup() throws {
		let service = BackupService(paths: paths, writer: database.writer, secrets: secrets, openRouter: nil)
		let staged = try service.restore(file: Self.fixture("ts-backup-legacy.json"), password: "hunter2")
		#expect(staged.legacy && staged.settings && !staged.projects)
		try BackupService.applyPending(paths, secrets: secrets, openRouter: nil)
		#expect(try Data(contentsOf: paths.legacyChatDatabase) == Data("SQLite format 3\0fake-chat-bytes".utf8))
	}

	@Test func snapshotsRotateInTheVault() throws {
		let vault = home.appending(path: "vault")
		setenv("TOBY_SYNC_DIR", vault.path, 1)
		defer { unsetenv("TOBY_SYNC_DIR") }
		try Data(#"{"version":1,"enabled":true,"deviceId":"dev-1","databaseBackupsEnabled":true}"#.utf8).write(to: home.appending(path: "sync-state.json"))
		let service = BackupService(paths: paths, writer: database.writer, secrets: secrets, openRouter: nil, passphrase: { "vault-pass" })
		#expect(service.snapshotsEnabled)
		for day in 0 ..< 5 { try service.createSnapshot(now: Date(timeIntervalSince1970: 1_800_000_000 + Double(day) * 86400)) }
		let list = service.snapshots()
		#expect(list.count == 3)
		#expect(list.first?.createdAt.hasPrefix("2027-01-19") == true)
		let staged = try service.restoreSnapshot(deviceID: "dev-1", filename: list[0].filename)
		#expect(staged.database && !staged.settings && !staged.legacy)
		#expect(throws: BackupArchive.Failure.self) { try service.restoreSnapshot(deviceID: "../x", filename: "a") }
		service.setSnapshotsEnabled(false)
		#expect(!service.snapshotsEnabled)
	}
}
