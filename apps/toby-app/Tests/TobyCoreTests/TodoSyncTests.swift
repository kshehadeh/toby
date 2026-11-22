import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

@Suite("scrypt")
struct ScryptTests {
	static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

	@Test func rfc7914Vectors() throws {
		let empty = try Scrypt.derive(password: Data(), salt: Data(), n: 16, r: 1, p: 1, keyLength: 64)
		#expect(Self.hex(empty) == "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906")
		let nacl = try Scrypt.derive(password: Data("password".utf8), salt: Data("NaCl".utf8), n: 1024, r: 8, p: 16, keyLength: 64)
		#expect(Self.hex(nacl) == "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640")
	}
}

@Suite("Todo sync")
struct TodoSyncTests {
	static let fixture: String = {
		let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appending(path: "Fixtures/ts-todo-batch.json")
		return (try? String(contentsOf: url, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
	}()

	@Test func decryptsBatchWrittenByTheDaemon() throws {
		let operations = try TodoBatchCodec.decrypt(Self.fixture, password: "fixture-password")
		#expect(operations.count == 1)
		#expect(operations[0].id == "op-ts-1")
		#expect(operations[0].changes[0].fields["title"] == "From TypeScript")
		#expect(throws: (any Error).self) { try TodoBatchCodec.decrypt(Self.fixture, password: "wrong") }
	}

	@Test func batchRoundTrips() throws {
		let operations = try TodoBatchCodec.decrypt(Self.fixture, password: "fixture-password")
		let reencrypted = try TodoBatchCodec.encrypt(operations, password: "pw")
		#expect(try TodoBatchCodec.decrypt(reencrypted, password: "pw") == operations)
	}

	@Test func rejectsWeakenedKDFParameters() throws {
		var envelope = try JSONValue(parsing: Self.fixture).objectValue!
		var encryption = envelope["encryption"]!.objectValue!
		encryption["n"] = 2
		envelope["encryption"] = .object(encryption)
		#expect(throws: TodoError.self) { try TodoBatchCodec.decrypt(JSONValue.object(envelope).jsonString(), password: "fixture-password") }
	}

	@Test func twoReplicasConvergeThroughASharedFolder() async throws {
		let shared = FileManager.default.temporaryDirectory.appending(path: "toby-sync-\(UUID().uuidString)/Toby/sync")
		try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: shared.deletingLastPathComponent().deletingLastPathComponent()) }
		let store = FileTodoBatchStore(rootDirectory: shared.path)
		let a = try TodoFixture()
		let b = try TodoFixture()
		let syncA = TodoSync(service: a.service)
		let syncB = TodoSync(service: b.service)

		let id = try #require(try a.create(["title": "Shared"])["id"]?.stringValue)
		let first = try await syncA.exchange(store: store, password: "pw")
		#expect(first.published >= 1)
		#expect(try syncA.status()["pending"] == 0)

		let pulled = try await syncB.exchange(store: store, password: "pw")
		#expect(pulled.pulled >= 1)
		#expect(try b.service.get(id)["title"] == "Shared")

		_ = try b.service.update(id, ["title": "Edited on B", "scope": "series"])
		_ = try await syncB.exchange(store: store, password: "pw")
		let back = try await syncA.exchange(store: store, password: "pw")
		#expect(back.pulled == 1)
		#expect(back.published == 0)
		#expect(try a.service.get(id)["title"] == "Edited on B")

		// Idempotent: nothing new either way.
		let quiet = try await syncA.exchange(store: store, password: "pw")
		#expect(quiet == TodoSync.ExchangeResult())
		let names = try await store.list()
		#expect(names.count == 2)
		await #expect(throws: (any Error).self) { try await store.write(names[0], contents: "{}") }
	}

	@Test func vaultRootMatchesNodePathResolve() {
		let folder = TodoSyncSettings(enabled: true, backend: "folder", folderPath: "/Users/me/Dropbox/", deviceID: "d")
		#expect(folder.vaultRoot(environment: [:]) == "/Users/me/Dropbox/Toby/sync")
		#expect(TodoSyncSettings.resolve("/a/b/../c/./config-sync") == "/a/c/sync")
		#expect(folder.vaultRoot(environment: ["TOBY_SYNC_DIR": "/tmp/x/"]) == "/tmp/x")
		// Destination identity = sha256(JSON.stringify(rootDir)), as in the daemon.
		#expect(TodoSync.destination(for: FileTodoBatchStore(rootDirectory: "/v")) == TodoHash.hex("/v"))
	}
}
