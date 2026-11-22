import Foundation
import TobyAI

/// Recordings under `listen/recordings/<id>/` (metadata.json, transcript.txt/
/// .json, summary.md, audio): list/detail/edit, Apple on-device transcription,
/// and AI summaries + titles (port of `listen/recordings.ts`, `summarizer.ts`,
/// `auto-summary.ts`, and the listen handlers). Capture stays in the app.
public struct ListenService: Sendable {
	let root: URL
	let configURL: URL
	let personas: PersonaService
	let ai: OpenRouterClient
	let bridge: any NativeBridge
	let summarizeText: (@Sendable (_ system: String, _ user: String, _ model: String, _ maxTokens: Int) async throws -> String)?

	public init(recordings root: URL, configURL: URL, personas: PersonaService, ai: OpenRouterClient, bridge: any NativeBridge,
	            summarizeText: (@Sendable (String, String, String, Int) async throws -> String)? = nil) {
		self.root = root
		self.configURL = configURL
		self.personas = personas
		self.ai = ai
		self.bridge = bridge
		self.summarizeText = summarizeText
	}

	public struct Recording: Sendable {
		public var id: String
		public var dir: URL
		public var metadata: [String: JSONValue]
	}

	static let summaryPrompt = """
	You are summarizing a recording transcript for the user.
	Produce a clear, scannable summary in markdown:
	- Start with a short overview (1-3 sentences) of what the recording is about.
	- Use bullet points for key topics, decisions, and action items when they appear.
	- Call out names, deadlines, and concrete next steps with **bold** where helpful.
	- Match length to the transcript: short for brief notes, a bit longer for meetings — but stay concise overall.
	- Do not invent details that are not in the transcript.
	- Output ONLY the final user-facing summary. Do not include chain-of-thought, planning, or meta-commentary.
	- Do not reference these instructions or mention that you are summarizing.
	"""

	static let titlePrompt = """
	You are generating a very short title for a recording based on its summary.
	Create a concise title (3-6 words) that captures the main topic or purpose:
	- Be specific and descriptive
	- Use sentence case (capitalize first word only, except proper nouns)
	- NO quotes, NO punctuation at the end
	- Keep it brief and scannable
	- Output ONLY the title text, nothing else
	"""

	// MARK: Files

	func config() -> JSONValue? {
		((try? Data(contentsOf: configURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) })?["listen"]
	}

	static func readMetadata(_ dir: URL) -> [String: JSONValue]? {
		(try? Data(contentsOf: dir.appending(path: "metadata.json"))).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }?.objectValue
	}

	static func writeMetadata(_ dir: URL, _ metadata: [String: JSONValue]) throws {
		try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		var data = try JSONEncoder.tobyPretty.encode(JSONValue.object(metadata))
		data.append(10)
		try data.write(to: dir.appending(path: "metadata.json"), options: .atomic)
	}

	func file(_ recording: Recording, _ key: String, fallback: String) -> URL? {
		let fm = FileManager.default
		if let raw = recording.metadata["files"]?[key]?.stringValue?.trimmingCharacters(in: .whitespaces), !raw.isEmpty {
			let candidate = raw.hasPrefix("/") ? URL(fileURLWithPath: raw) : recording.dir.appending(path: raw)
			if fm.fileExists(atPath: candidate.path) { return candidate }
		}
		let candidate = recording.dir.appending(path: fallback)
		return fm.fileExists(atPath: candidate.path) ? candidate : nil
	}

	func audioPaths(_ recording: Recording) -> (combined: URL?, mic: URL?, system: URL?) {
		(file(recording, "combined", fallback: "combined.m4a"), file(recording, "mic", fallback: "mic.wav"), file(recording, "system", fallback: "system.wav"))
	}

	func audio(_ recording: Recording) -> URL? {
		let paths = audioPaths(recording)
		return paths.combined ?? paths.mic ?? paths.system
	}

	static func nonEmptyText(_ url: URL?) -> String? {
		url.flatMap { try? String(contentsOf: $0, encoding: .utf8) }?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
	}

	public func list() -> [Recording] {
		let entries = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
		return entries.compactMap { dir -> Recording? in
			guard dir.lastPathComponent != ".tmp", (try? dir.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true, let metadata = Self.readMetadata(dir) else { return nil }
			return Recording(id: metadata["id"]?.stringValue?.nilIfEmpty ?? dir.lastPathComponent, dir: dir, metadata: metadata)
		}.sorted {
			let a = TodoRecurrence.parseISO($0.metadata["startedAt"]?.stringValue ?? $0.metadata["createdAt"]?.stringValue ?? "") ?? .distantPast
			let b = TodoRecurrence.parseISO($1.metadata["startedAt"]?.stringValue ?? $1.metadata["createdAt"]?.stringValue ?? "") ?? .distantPast
			return a > b
		}
	}

	public func find(_ id: String) -> Recording? {
		let trimmed = id.trimmingCharacters(in: .whitespaces)
		return trimmed.isEmpty ? nil : list().first { $0.id == trimmed }
	}

	func require(_ id: String) throws -> Recording {
		guard let recording = find(id) else { throw TodoError("not_found", "Recording not found", status: 404) }
		return recording
	}

	// MARK: API payloads

	public func listJSON() -> JSONValue {
		["recordings": .array(list().map { r in
			var item: [String: JSONValue] = ["id": .string(r.id), "dir": .string(r.dir.path)]
			for key in ["name", "description", "createdAt", "startedAt", "stoppedAt", "durationMs", "sources"] { if let value = r.metadata[key] { item[key] = value } }
			item["hasAudio"] = .bool(audio(r) != nil)
			item["hasTranscript"] = .bool(Self.nonEmptyText(file(r, "transcript", fallback: "transcript.txt")) != nil)
			item["hasSummary"] = .bool(Self.nonEmptyText(file(r, "summary", fallback: "summary.md")) != nil)
			return .object(item)
		})]
	}

	/// The daemon's recording detail payload.
	public func detail(_ recording: Recording) -> JSONValue {
		let paths = audioPaths(recording)
		var out: [String: JSONValue] = ["id": .string(recording.id), "dir": .string(recording.dir.path), "metadata": .object(recording.metadata)]
		let audio = paths.combined ?? paths.mic ?? paths.system
		out["hasAudio"] = .bool(audio != nil)
		if let audio { out["audioPath"] = .string(audio.path) }
		if let path = paths.combined { out["combinedPath"] = .string(path.path) }
		if let path = paths.mic { out["micPath"] = .string(path.path) }
		if let path = paths.system { out["systemPath"] = .string(path.path) }
		let transcriptURL = file(recording, "transcript", fallback: "transcript.txt")
		let text = transcriptURL.flatMap { try? String(contentsOf: $0, encoding: .utf8) }?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		out["hasTranscript"] = true
		out["transcript"] = .string(text)
		if let json = file(recording, "transcriptJson", fallback: "transcript.json") {
			if let payload = (try? Data(contentsOf: json)).flatMap({ try? JSONDecoder().decode(JSONValue.self, from: $0) }) {
				if let segments = payload["segments"] { out["segments"] = segments }
			} else {
				out["warnings"] = ["transcript.json could not be parsed; returned plain text only."]
			}
		} else {
			out["warnings"] = ["transcript.json not found; returned plain text only."]
		}
		if let summary = Self.nonEmptyText(file(recording, "summary", fallback: "summary.md")) {
			out["hasSummary"] = true
			out["summary"] = .string(summary)
			if let meta = recording.metadata["summary"] { out["summaryMeta"] = meta }
		} else {
			out["hasSummary"] = false
		}
		return .object(out)
	}

	public func detail(id: String) throws -> JSONValue { detail(try require(id)) }

	// MARK: Edits

	public func update(_ id: String, name: String?, description: String?, chatSessionID: JSONValue?) throws -> JSONValue {
		var recording = try require(id)
		guard name != nil || description != nil || chatSessionID != nil else { throw TodoError.invalid("Body must include 'name', 'description', or 'chatSessionId' field") }
		if let name { recording.metadata["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines)) }
		if let description { recording.metadata["description"] = .string(description.trimmingCharacters(in: .whitespacesAndNewlines)) }
		if let chatSessionID {
			if let session = chatSessionID.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty { recording.metadata["chatSessionId"] = .string(session) } else {
				recording.metadata.removeValue(forKey: "chatSessionId")
			}
		}
		try Self.writeMetadata(recording.dir, recording.metadata)
		return detail(recording)
	}

	public func delete(_ id: String) throws {
		let recording = try require(id)
		try FileManager.default.removeItem(at: recording.dir)
	}

	/// Remove audio files, keep transcript/summary/metadata.
	@discardableResult
	public func deleteAudio(_ recording: Recording) throws -> Recording {
		var next = recording
		let paths = audioPaths(recording)
		for url in [paths.combined, paths.mic, paths.system].compactMap({ $0 }) { try? FileManager.default.removeItem(at: url) }
		var files = next.metadata["files"]?.objectValue ?? [:]
		for key in ["mic", "system", "combined"] { files.removeValue(forKey: key) }
		next.metadata["files"] = .object(files)
		next.metadata["audioDeletedAt"] = .string(TodoRecurrence.isoString(Date()))
		try Self.writeMetadata(next.dir, next.metadata)
		return next
	}

	public func deleteAudio(id: String) throws -> JSONValue { detail(try deleteAudio(try require(id))) }

	func appendError(_ recording: Recording, _ message: String) -> Recording {
		var next = recording
		var errors = (next.metadata["errors"]?.arrayValue ?? []).compactMap(\.stringValue)
		if !errors.contains(message) { errors.append(message) }
		next.metadata["errors"] = .array(errors.map(JSONValue.string))
		try? Self.writeMetadata(next.dir, next.metadata)
		return next
	}

	// MARK: Summaries

	func summaryPersona() -> Persona {
		if let name = config()?["summaryPersona"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty, let persona = personas.resolve(name) { return persona }
		return personas.defaultPersona()
	}

	/// Strip `<think>`/`<reasoning>` blocks models sometimes emit.
	static func userFacing(_ text: String) -> String {
		text.replacing(/(?is)<(think|thinking|reasoning)>.*?<\/\1>/, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
	}

	static func duration(_ ms: Double?) -> String? {
		guard let ms, ms.isFinite, ms >= 0 else { return nil }
		let total = Int((ms / 1000).rounded())
		return total < 60 ? "\(total)s" : "\(total / 60)m \(String(format: "%02d", total % 60))s"
	}

	func complete(system: String, user: String, persona: Persona, maxTokens: Int, timeout: Double) async throws -> String {
		if let summarizeText { return try await summarizeText(system, user, persona.openRouterModel, maxTokens) }
		let model = ai.model(persona.openRouterModel)
		return try await FlowRunner.withTimeout(timeout) {
			try await generateText(TextRequest(model: model, instructions: system, messages: [.user(user)], temperature: 0.3, maxOutputTokens: maxTokens)).text
		}
	}

	/// Summarize a transcript with the listen summary persona.
	public func summarize(transcript: String, name: String?, durationMs: Double?) async throws -> (text: String, persona: String) {
		let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty else { throw TodoError.invalid("Cannot summarize an empty transcript.") }
		let persona = summaryPersona()
		var header: [String] = []
		if let name = name?.trimmingCharacters(in: .whitespaces).nilIfEmpty { header.append("Recording name: \(name)") }
		if let duration = Self.duration(durationMs) { header.append("Duration: \(duration)") }
		let user = (header.isEmpty ? "" : header.joined(separator: "\n") + "\n\n") + "Transcript:\n\n\(text)"
		let summary = Self.userFacing(try await complete(system: ChatPrompt.compose(base: Self.summaryPrompt, persona: persona), user: user, persona: persona, maxTokens: 2000, timeout: 60))
		guard !summary.isEmpty else { throw TodoError.invalid("Model returned an empty summary.") }
		return (summary, persona.name)
	}

	/// First line, minus labels, quotes, markdown markers, trailing punctuation.
	public static func normalizeTitle(_ raw: String) -> String {
		let line = userFacing(raw).split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } ?? ""
		var title = line.replacing(/^#+\s*/, with: "").replacing(/^[-*]\s+/, with: "").replacing(/(?i)^title\s*:\s*/, with: "")
		if let bold = title.wholeMatch(of: /\*\*(.*)\*\*/) { title = String(bold.1) }
		title = title.trimmingCharacters(in: .whitespaces).replacing(/^["'“‘`]+|["'”’`]+$/, with: "").trimmingCharacters(in: .whitespaces)
		title = title.replacing(/[.!?;,:]+$/, with: "").trimmingCharacters(in: .whitespaces)
		return String(title.prefix(120)).trimmingCharacters(in: .whitespaces)
	}

	func writeSummary(_ recording: Recording, text: String, persona: String) throws -> Recording {
		var next = recording
		try Data((text + "\n").utf8).write(to: recording.dir.appending(path: "summary.md"), options: .atomic)
		next.metadata.removeValue(forKey: "errors")
		var files = next.metadata["files"]?.objectValue ?? [:]
		files["summary"] = "summary.md"
		next.metadata["files"] = .object(files)
		next.metadata["summary"] = ["createdAt": .string(TodoRecurrence.isoString(Date())), "personaName": .string(persona)]
		try Self.writeMetadata(next.dir, next.metadata)
		return next
	}

	/// `POST /api/listen/recordings/:id/summarize` (doesn't rename).
	public func summarize(id: String) async throws -> JSONValue {
		let recording = try require(id)
		guard let transcript = Self.nonEmptyText(file(recording, "transcript", fallback: "transcript.txt")) else {
			throw TodoError.invalid("No transcript is available for this recording. Transcribe it first.")
		}
		do {
			let result = try await summarize(transcript: transcript, name: recording.metadata["name"]?.stringValue, durationMs: recording.metadata["durationMs"]?.doubleValue)
			return detail(try writeSummary(recording, text: result.text, persona: result.persona))
		} catch {
			_ = appendError(recording, (error as? LocalizedError)?.errorDescription ?? "\(error)")
			throw error
		}
	}

	/// After transcription: summary, then an AI title when the user hasn't named it.
	func autoSummarize(_ recording: Recording, onStatus: @Sendable (String) -> Void) async -> Recording {
		guard let transcript = Self.nonEmptyText(file(recording, "transcript", fallback: "transcript.txt")) else { return recording }
		onStatus("Summarizing recording…")
		let summarized: Recording
		let summaryText: String
		do {
			let result = try await summarize(transcript: transcript, name: recording.metadata["name"]?.stringValue, durationMs: recording.metadata["durationMs"]?.doubleValue)
			summaryText = result.text
			summarized = try writeSummary(recording, text: result.text, persona: result.persona)
		} catch {
			return appendError(recording, "Auto-summarization failed: \((error as? LocalizedError)?.errorDescription ?? "\(error)")")
		}
		if summarized.metadata["name"]?.stringValue?.trimmingCharacters(in: .whitespaces).isEmpty == false { return summarized }
		onStatus("Naming recording…")
		do {
			let persona = summaryPersona()
			let title = Self.normalizeTitle(try await complete(system: ChatPrompt.compose(base: Self.titlePrompt, persona: persona), user: "Summary:\n\n\(summaryText)", persona: persona, maxTokens: 1024, timeout: 30))
			guard !title.isEmpty else { return appendError(summarized, "Title generation failed: Model returned an empty title.") }
			var named = summarized
			named.metadata["name"] = .string(title)
			try Self.writeMetadata(named.dir, named.metadata)
			return named
		} catch {
			return appendError(summarized, "Title generation failed: \((error as? LocalizedError)?.errorDescription ?? "\(error)")")
		}
	}

	// MARK: Transcription

	/// Transcribe on device (or reuse a complete live transcript), then summarize.
	public func transcribe(id: String, reuseLiveTranscript: Bool, onStatus: @escaping @Sendable (String) -> Void = { _ in }) async throws -> JSONValue {
		let recording = try require(id)
		guard let input = audio(recording) else {
			let message = "Recording has no readable audio file. Expected combined.m4a, mic.wav, or system.wav."
			_ = appendError(recording, message)
			throw TodoError.invalid(message)
		}
		do {
			var reused = false
			if reuseLiveTranscript, let payload = (try? Data(contentsOf: recording.dir.appending(path: "transcript.json"))).flatMap({ try? JSONDecoder().decode(JSONValue.self, from: $0) }),
			   payload["text"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false, payload["engine"] == "apple-live", payload["complete"] == true,
			   FileManager.default.fileExists(atPath: recording.dir.appending(path: "transcript.txt").path) {
				reused = true
			}
			if !reused {
				onStatus("Transcribing on your Mac; downloading the speech language model if needed…")
				let payload = try await bridge.data("audio/transcribe", ["input": .string(input.path)])
				guard let text = payload["text"]?.stringValue, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, payload["segments"]?.arrayValue != nil else {
					throw TodoError.invalid("No speech was recognized. Audio has been kept for retry.")
				}
				try Data("\(text)\n".utf8).write(to: recording.dir.appending(path: "transcript.txt"), options: .atomic)
				var json = try JSONEncoder.tobyPretty.encode(payload)
				json.append(10)
				try json.write(to: recording.dir.appending(path: "transcript.json"), options: .atomic)
			}
			// Finalize: clear the old summary and errors, record transcript files.
			var next = recording
			if let summary = file(recording, "summary", fallback: "summary.md") { try? FileManager.default.removeItem(at: summary) }
			var files = next.metadata["files"]?.objectValue ?? [:]
			files.removeValue(forKey: "summary")
			files["transcript"] = "transcript.txt"
			files["transcriptJson"] = "transcript.json"
			next.metadata["files"] = .object(files)
			next.metadata.removeValue(forKey: "summary")
			next.metadata.removeValue(forKey: "errors")
			try Self.writeMetadata(next.dir, next.metadata)
			if config()?["deleteAudioAfterTranscription"] != false { next = try deleteAudio(next) }
			return detail(await autoSummarize(next, onStatus: onStatus))
		} catch {
			_ = appendError(recording, (error as? LocalizedError)?.errorDescription ?? "\(error)")
			throw error
		}
	}
}
