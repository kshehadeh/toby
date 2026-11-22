import CoreGraphics
import CoreText
import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

struct EchoSummarizer: LibrarySummarizer {
	func summarize(filename: String, mimeType: String, extractedText: String?, bytes: Data) async throws -> String {
		"Summary of \(filename): \(String((extractedText ?? "image").prefix(40)))"
	}
}

final class LibraryFixture {
	let home: URL
	let database: TobyDatabase
	let library: LibraryService

	init(embedder: (any TextEmbedder)? = nil) throws {
		home = try temporaryHome()
		database = try TobyDatabase.inMemory()
		let embed = embedder
		library = LibraryService(writer: database.writer, libraryDirectory: home.appending(path: "library"), summarizer: { EchoSummarizer() }, embedder: { embed })
	}

	deinit { try? FileManager.default.removeItem(at: home) }
}

/// A one-page PDF containing `text`, drawn with Core Text.
func makePDF(_ text: String) -> Data {
	let data = NSMutableData()
	var box = CGRect(x: 0, y: 0, width: 612, height: 792)
	let consumer = CGDataConsumer(data: data as CFMutableData)!
	let context = CGContext(consumer: consumer, mediaBox: &box, nil)!
	context.beginPDFPage(nil)
	let font = CTFontCreateWithName("Helvetica" as CFString, 14, nil)
	let attributed = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
	context.textPosition = CGPoint(x: 72, y: 700)
	CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
	context.endPDFPage()
	context.closePDF()
	return data as Data
}

@Suite("Library")
struct LibraryServiceTests {
	@Test func addsIndexesAndDeduplicatesWithReferences() async throws {
		let f = try LibraryFixture()
		let first = try await f.library.add(filename: "Trip_notes-2027.md", bytes: Data("# Lisbon\nFlights on Friday".utf8), waitForIndex: true)
		#expect(!first.duplicate)
		#expect(first.item["title"] == "Trip notes 2027")
		#expect(first.item["mimeType"] == "text/markdown")
		#expect(first.item["status"] == "ready")
		#expect(first.item["description"]?.stringValue?.hasPrefix("Summary of Trip_notes-2027.md: # Lisbon") == true)
		#expect(first.item["error"] == nil)
		let id = try #require(first.item["id"]?.stringValue)
		#expect(FileManager.default.fileExists(atPath: f.home.appending(path: "library/\(id)/extracted.txt").path))

		let again = try await f.library.add(filename: "copy.md", bytes: Data("# Lisbon\nFlights on Friday".utf8), reference: ["kind": "chat", "label": "Planning", "sessionId": "s1", "detail": "copy.md"])
		#expect(again.duplicate)
		#expect(again.item["id"]?.stringValue == id)
		#expect(again.item["references"]?.arrayValue?.map { $0["kind"]?.stringValue } == ["manual", "chat"])
		#expect(try f.library.list(origin: "chat").total == 1)
		#expect(try f.library.list(origin: "project").total == 0)
	}

	@Test func extractsPDFTextWithPDFKit() async throws {
		let f = try LibraryFixture()
		let result = try await f.library.add(filename: "invoice.pdf", bytes: makePDF("Invoice 4471 from Acme Corp"), waitForIndex: true)
		#expect(result.item["status"] == "ready")
		#expect(result.item["description"]?.stringValue?.contains("Invoice 4471") == true)
		let found = try await f.library.search("acme invoice")
		#expect(found.first?["id"] == result.item["id"])
	}

	@Test func rejectsUnsupportedEmptyAndOversizedFiles() async throws {
		let f = try LibraryFixture()
		await #expect(throws: TodoError.self) { try await f.library.add(filename: "a.zip", bytes: Data([1])) }
		await #expect(throws: TodoError.self) { try await f.library.add(filename: "a.txt", bytes: Data()) }
		await #expect(throws: TodoError.self) { try await f.library.add(filename: "a.txt", bytes: Data(count: LibraryMedia.maxBytes + 1)) }
	}

	@Test func semanticSearchUsesEmbeddings() async throws {
		let f = try LibraryFixture(embedder: FakeEmbedder())
		_ = try await f.library.add(filename: "drinks.txt", bytes: Data("I enjoy black coffee".utf8), waitForIndex: true)
		_ = try await f.library.add(filename: "meet.txt", bytes: Data("Team meetings agenda".utf8), waitForIndex: true)
		let results = try await f.library.search("morning coffee")
		#expect(results.first?["originalFilename"] == "drinks.txt")
		#expect(results.first?["embeddingModel"] == "test/embed")
	}

	@Test func replacingTheFileReindexesAndBlocksDuplicates() async throws {
		let f = try LibraryFixture()
		let a = try await f.library.add(filename: "a.txt", bytes: Data("alpha".utf8), waitForIndex: true)
		_ = try await f.library.add(filename: "b.txt", bytes: Data("beta".utf8), waitForIndex: true)
		let id = try #require(a.item["id"]?.stringValue)
		let replaced = try await f.library.update(id, filename: "a2.txt", bytes: Data("alpha two".utf8))
		#expect(replaced["originalFilename"] == "a2.txt")
		#expect(replaced["description"]?.stringValue?.contains("alpha two") == true)
		#expect(!FileManager.default.fileExists(atPath: f.home.appending(path: "library/\(id)/a.txt").path))
		await #expect(throws: TodoError.self) { try await f.library.update(id, bytes: Data("beta".utf8)) }
		let renamed = try await f.library.update(id, title: "Alpha", description: "Edited")
		#expect(renamed["title"] == "Alpha")
		#expect(renamed["description"] == "Edited")
		#expect(try f.library.remove(id))
		#expect(!FileManager.default.fileExists(atPath: f.home.appending(path: "library/\(id)").path))
		#expect(try f.library.get(id) == nil)
	}

	@Test func catalogsOpaqueFilesProjectFilesAndChatAttachments() async throws {
		let f = try LibraryFixture()
		let opaque = try #require(try await f.library.catalog(filename: "data.bin", bytes: Data([0, 1, 2]), mediaType: "application/octet-stream", source: "chat", reference: ["kind": "chat", "label": "Chat"]))
		#expect(opaque.item["status"] == "ready")
		#expect(opaque.item["description"] == "Original application/octet-stream file saved for reference.")

		let projects = ProjectService(writer: f.database.writer, tobyDirectory: f.home)
		let project = try projects.create(name: "Atlas")
		try "Research plan".write(toFile: project.folderPath + "/plan.txt", atomically: true, encoding: .utf8)
		try await f.database.writer.write { db in
			try db.execute(sql: "INSERT INTO chat_sessions (id, name, created_at, updated_at) VALUES ('s1', 'Kickoff', 'now', 'now')")
			let text = #"{"text":"see attached","attachments":[{"filename":"note.md","mediaType":"text/markdown","dataBase64":"\#(Data("Kickoff notes".utf8).base64EncodedString())"}]}"#
			try db.execute(sql: "INSERT INTO chat_session_transcript (session_id, idx, kind, text) VALUES ('s1', 0, 'user', ?)", arguments: [text])
		}
		await f.library.syncCatalog(projects: projects)
		await f.library.waitForIndexing()
		let all = try f.library.list().items
		let names = Set(all.compactMap { $0["originalFilename"]?.stringValue })
		#expect(names.isSuperset(of: ["plan.txt", "note.md", "data.bin"]))
		#expect(!names.contains("AGENTS.md"))
		#expect(try f.library.list(origin: "project").total == 1)
		// Second sync is a no-op.
		await f.library.syncCatalog(projects: projects)
		#expect(try f.library.list().total == all.count)
	}

	@Test func mediaHelpersMatchTheDaemon() {
		#expect(LibraryMedia.detect(filename: "x.MD", mediaType: nil) == "text/markdown")
		#expect(LibraryMedia.detect(filename: "x", mediaType: "image/jpg") == "image/jpeg")
		#expect(LibraryMedia.detect(filename: "x.csv", mediaType: "text/csv") == "text/plain")
		#expect(LibraryMedia.sanitize("../a<b>:c?.txt") == "a_b__c_.txt")
		#expect(LibraryMedia.sanitize("extracted.txt") == "file-extracted.txt")
		#expect(LibraryMedia.catalogStorage(filename: "main.swift", mediaType: nil) == ("text/plain", true))
		#expect(LibraryService.isCatalogedProjectPath(".agent/skills/x/SKILL.md") == false)
		#expect(LibraryService.isCatalogedProjectPath("research/a.pdf"))
	}
}
