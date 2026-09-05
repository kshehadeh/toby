import Foundation
import Testing
@testable import TobyApp

@Suite("FileQuickLook")
struct FileQuickLookTests {
	@Test("preview URL is nil for a missing path")
	func previewURLMissingPath() {
		#expect(FileQuickLook.previewURL(for: "/tmp/toby-missing-quicklook-\(UUID().uuidString).txt") == nil)
	}

	@Test("preview URL is nil for a directory")
	func previewURLDirectory() throws {
		let dir = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-quicklook-dir-\(UUID().uuidString)", isDirectory: true)
		try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: dir) }

		#expect(FileQuickLook.previewURL(for: dir.path) == nil)
	}

	@Test("preview URL returns the existing file")
	func previewURLExistingFile() throws {
		let file = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-quicklook-\(UUID().uuidString).txt")
		try "hello".write(to: file, atomically: true, encoding: .utf8)
		defer { try? FileManager.default.removeItem(at: file) }

		let preview = FileQuickLook.previewURL(for: file.path)
		#expect(preview?.standardizedFileURL == file.standardizedFileURL)
	}

	@Test("previewOrOpen sets the preview URL for an existing file")
	@MainActor
	func previewOrOpenExistingFile() throws {
		let file = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-quicklook-\(UUID().uuidString).md")
		try "# notes".write(to: file, atomically: true, encoding: .utf8)
		defer { try? FileManager.default.removeItem(at: file) }

		var preview: URL?
		FileQuickLook.previewOrOpen(path: file.path) { preview = $0 }
		#expect(preview?.standardizedFileURL == file.standardizedFileURL)
	}
}
