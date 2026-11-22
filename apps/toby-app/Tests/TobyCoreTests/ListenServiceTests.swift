import Foundation
import Testing
import TobyAI
@testable import TobyCore

@Suite("Listen recordings")
struct ListenServiceTests {
	let home: URL
	let recordings: URL

	init() throws {
		home = try temporaryHome()
		recordings = home.appending(path: "listen/recordings")
		for (id, started, name) in [("r1", "2026-11-20T10:00:00.000Z", ""), ("r2", "2026-11-21T10:00:00.000Z", "Standup")] {
			let dir = recordings.appending(path: id)
			try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
			var metadata: [String: JSONValue] = ["id": .string(id), "createdAt": .string(started), "startedAt": .string(started), "durationMs": 95000,
			                                     "sources": ["mic": true, "system": true], "files": ["combined": "combined.m4a"], "platform": "darwin", "combine": ["mode": "dual-mono"]]
			if !name.isEmpty { metadata["name"] = .string(name) }
			try ListenService.writeMetadata(dir, metadata)
			try Data("audio".utf8).write(to: dir.appending(path: "combined.m4a"))
		}
	}

	func service(_ bridge: FakeBridge, calls: CallLog = CallLog()) -> ListenService {
		ListenService(recordings: recordings, configURL: home.appending(path: "config.json"), personas: PersonaService(tobyDirectory: home),
		              ai: OpenRouterClient(keyProvider: StaticAPIKey("x")), bridge: bridge) { system, user, _, _ in
			calls.add(user)
			return system.contains("very short title") ? "\"Quarterly budget review.\"" : "<think>hmm</think>The team agreed on the **Q1 budget**."
		}
	}

	final class CallLog: @unchecked Sendable {
		private let lock = NSLock()
		private var stored: [String] = []
		func add(_ value: String) { lock.withLock { stored.append(value) } }
		var values: [String] { lock.withLock { stored } }
	}

	@Test func listsNewestFirstAndReportsFiles() {
		let listen = service(FakeBridge([:]))
		let list = listen.listJSON()["recordings"]?.arrayValue ?? []
		#expect(list.compactMap { $0["id"]?.stringValue } == ["r2", "r1"])
		#expect(list[0]["hasAudio"] == true)
		#expect(list[0]["hasTranscript"] == false)
	}

	@Test func transcribesSummarizesNamesAndDeletesAudio() async throws {
		let bridge = FakeBridge(["audio/transcribe": ["ok": true, "data": ["text": "We agreed on the budget.", "segments": [["start": 0, "end": 2, "text": "We agreed on the budget."]], "engine": "apple"]]])
		let calls = CallLog()
		let listen = service(bridge, calls: calls)
		let statuses = CallLog()
		let detail = try await listen.transcribe(id: "r1", reuseLiveTranscript: false) { statuses.add($0) }
		#expect(detail["transcript"] == "We agreed on the budget.")
		#expect(detail["segments"]?.arrayValue?.count == 1)
		#expect(detail["summary"] == "The team agreed on the **Q1 budget**.")
		#expect(detail["metadata"]?["name"] == "Quarterly budget review")
		#expect(detail["metadata"]?["combine"]?["mode"] == "dual-mono", "unknown metadata is preserved")
		#expect(detail["hasAudio"] == false)
		#expect(detail["metadata"]?["audioDeletedAt"]?.stringValue != nil)
		#expect(statuses.values.contains("Summarizing recording…"))
		#expect(calls.values.first?.contains("Duration: 1m 35s") == true)
		#expect(bridge.recorded.first?.1["input"]?.stringValue?.hasSuffix("r1/combined.m4a") == true)
	}

	@Test func reusesACompleteLiveTranscriptAndKeepsUserNames() async throws {
		let dir = recordings.appending(path: "r2")
		try Data("Live words.\n".utf8).write(to: dir.appending(path: "transcript.txt"))
		try Data(#"{"text":"Live words.","engine":"apple-live","complete":true,"segments":[]}"#.utf8).write(to: dir.appending(path: "transcript.json"))
		try Data(#"{"listen":{"deleteAudioAfterTranscription":false}}"#.utf8).write(to: home.appending(path: "config.json"))
		let bridge = FakeBridge([:])
		let detail = try await service(bridge).transcribe(id: "r2", reuseLiveTranscript: true)
		#expect(bridge.recorded.isEmpty, "no re-transcription")
		#expect(detail["metadata"]?["name"] == "Standup")
		#expect(detail["hasAudio"] == true)
		#expect(detail["hasSummary"] == true)
	}

	@Test func editsAndErrors() async throws {
		let listen = service(FakeBridge(["audio/transcribe": ["ok": true, "data": ["text": "  ", "segments": []]]]))
		#expect(try listen.update("r1", name: "  Kickoff ", description: nil, chatSessionID: "s-1")["metadata"]?["name"] == "Kickoff")
		#expect(try listen.update("r1", name: nil, description: nil, chatSessionID: .null)["metadata"]?["chatSessionId"] == nil)
		await #expect(throws: TodoError.self) { try await listen.summarize(id: "r1") }
		await #expect(throws: TodoError.self) { try await listen.transcribe(id: "r1", reuseLiveTranscript: false) }
		#expect(try listen.detail(id: "r1")["metadata"]?["errors"]?[0] == "No speech was recognized. Audio has been kept for retry.")
		#expect(throws: TodoError.self) { try listen.detail(id: "missing") }
		#expect(ListenService.normalizeTitle("## Title: **Budget sync!**") == "Budget sync")
	}
}
