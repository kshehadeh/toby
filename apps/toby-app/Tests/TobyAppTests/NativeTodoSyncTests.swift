import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("Native todo sync transport", .serialized)
struct NativeTodoSyncTests {
	@Test("coordinates encrypted immutable batches without changing settings vault")
	func roundTrip() throws {
		let root = FileManager.default.temporaryDirectory.appendingPathComponent("toby-todo-sync-\(UUID().uuidString)")
		let previous = NativeICloudHandler.rootOverride
		NativeICloudHandler.rootOverride = root
		defer {
			NativeICloudHandler.rootOverride = previous
			try? FileManager.default.removeItem(at: root)
		}
		func call(_ action: String, _ input: [String: Any] = [:]) throws -> [String: Any] {
			let body = try JSONSerialization.data(withJSONObject: input)
			return try #require(JSONSerialization.jsonObject(with: NativeTodoSyncHandler.handle(action, body: body)) as? [String: Any])
		}
		let contents = #"{"version":1,"format":"toby.todos.operations.encrypted","ciphertext":"synthetic"}"#
		let input: [String: Any] = ["name": "replica/batch.json", "contents": contents]
		#expect(try call("write", input)["ok"] as? Bool == true)
		#expect(try call("write", input)["ok"] as? Bool == false)
		let listing = try #require(try call("list")["data"] as? [String: Any])
		#expect(listing["files"] as? [String] == ["replica/batch.json"])
		let read = try #require(try call("read", ["name": "replica/batch.json"])["data"] as? [String: Any])
		#expect(read["contents"] as? String == contents)
		#expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("settings.json").path))
		#expect(try call("read", ["name": "../outside.json"])["ok"] as? Bool == false)
		#expect(try call("write", ["name": "replica/plain.json", "contents": #"{"title":"plain"}"#])["ok"] as? Bool == false)
	}

	@Test("rejects symlinks out of the todo batch namespace")
	func rejectsSymlinks() throws {
		let root = FileManager.default.temporaryDirectory.appendingPathComponent("toby-todo-symlink-\(UUID().uuidString)")
		let outside = FileManager.default.temporaryDirectory.appendingPathComponent("toby-outside-\(UUID().uuidString)")
		let previous = NativeICloudHandler.rootOverride
		NativeICloudHandler.rootOverride = root
		defer {
			NativeICloudHandler.rootOverride = previous
			try? FileManager.default.removeItem(at: root)
			try? FileManager.default.removeItem(at: outside)
		}
		try FileManager.default.createDirectory(at: root.appendingPathComponent("todos/v1"), withIntermediateDirectories: true)
		try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
		try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("todos/v1/replica"), withDestinationURL: outside)
		#expect(throws: (any Error).self) { try NativeTodoSyncHandler.batchURL("replica/batch.json") }
	}
}
