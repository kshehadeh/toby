import Foundation
import Testing
@testable import TobyApp

@Suite("Native file discovery")
struct NativeFilesTests {
	private func list(_ input: [String: Any]) async throws -> [String: Any] {
		let body = try JSONSerialization.data(withJSONObject: input)
		return try #require(JSONSerialization.jsonObject(with: await NativeFilesHandler.list(body: body)) as? [String: Any])
	}

	@Test("filter images, exclude hidden files and symlinks, and page stable filenames")
	func imageDiscovery() async throws {
		let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: folder) }
		for name in ["a.png", "B.jpeg", "c.txt", ".hidden.png"] {
			try Data("test".utf8).write(to: folder.appendingPathComponent(name))
		}
		try FileManager.default.createDirectory(at: folder.appendingPathComponent("nested.png"), withIntermediateDirectories: true)
		try FileManager.default.createSymbolicLink(at: folder.appendingPathComponent("link.png"), withDestinationURL: folder.appendingPathComponent("a.png"))
		let response = try await list(["folder": folder.path, "kind": "images", "limit": 1])
		#expect(response["ok"] as? Bool == true)
		let data = try #require(response["data"] as? [String: Any])
		#expect(data["totalMatches"] as? Int == 2)
		#expect(data["hasMore"] as? Bool == true)
		#expect(data["nextOffset"] as? Int == 1)
		let entries = try #require(data["entries"] as? [[String: Any]])
		#expect(entries.first?["name"] as? String == "B.jpeg")
		#expect(entries.first?["sizeBytes"] as? Int == 4)
		let second = try await list(["folder": folder.path, "kind": "images", "offset": 1])
		let secondData = try #require(second["data"] as? [String: Any])
		#expect(secondData["hasMore"] as? Bool == false)
		#expect((secondData["entries"] as? [[String: Any]])?.first?["name"] as? String == "a.png")
		let filtered = try await list(["folder": folder.path, "nameContains": "B.JPEG"])
		#expect((filtered["data"] as? [String: Any])?["totalMatches"] as? Int == 1)
	}

	@Test("reject relative paths, invalid pagination and missing folders")
	func invalidInputs() async throws {
		for input: [String: Any] in [
			["folder": "relative/path"], ["kind": "video"], ["limit": 201], ["limit": 1.5],
			["offset": -1], ["limit": true], ["folder": "/toby-nonexistent-\(UUID().uuidString)"]
		] {
			let response = try await list(input)
			#expect(response["ok"] as? Bool == false)
			#expect(response["error"] as? String != nil)
		}
	}
}
