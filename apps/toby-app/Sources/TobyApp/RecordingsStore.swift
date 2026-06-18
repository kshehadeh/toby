import Foundation
import Observation

@Observable
@MainActor
final class RecordingsStore {
	var recordings: [ListenRecordingSummary] = []
	var selectedRecordingId: String?
	var detail: ListenRecordingDetail?
	var isLoading = false
	var isDetailLoading = false
	var errorMessage: String?

	var selectedRecording: ListenRecordingSummary? {
		guard let selectedRecordingId else { return nil }
		return recordings.first { $0.id == selectedRecordingId }
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			recordings = try LocalRecordingsRepository.listRecordings()
			if selectedRecordingId == nil || !recordings.contains(where: { $0.id == selectedRecordingId }) {
				selectedRecordingId = recordings.first?.id
			}
			if let selectedRecordingId {
				await selectRecording(id: selectedRecordingId)
			} else {
				detail = nil
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectRecording(id: String) async {
		selectedRecordingId = id
		isDetailLoading = true
		errorMessage = nil
		defer { isDetailLoading = false }
		do {
			detail = try LocalRecordingsRepository.fetchRecording(id: id)
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}

private enum LocalRecordingsRepository {
	static func listRecordings() throws -> [ListenRecordingSummary] {
		let root = recordingsDirectory()
		guard FileManager.default.fileExists(atPath: root.path) else { return [] }
		let dirs = try FileManager.default.contentsOfDirectory(
			at: root,
			includingPropertiesForKeys: [.isDirectoryKey],
		)
		return dirs
			.filter { url in
				(try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
			}
			.compactMap { directory -> ListenRecordingSummary? in
				guard let metadata = try? readMetadata(directory: directory) else { return nil }
				return ListenRecordingSummary(
					id: metadata.id,
					dir: directory.path,
					name: metadata.name,
					description: metadata.description,
					createdAt: metadata.createdAt,
					startedAt: metadata.startedAt,
					stoppedAt: metadata.stoppedAt,
					durationMs: metadata.durationMs,
					sources: metadata.sources,
					hasAudio: hasAudio(metadata: metadata, directory: directory),
					hasTranscript: hasTranscript(metadata: metadata, directory: directory),
				)
			}
			.sorted { lhs, rhs in
				sortDate(lhs.startedAt, fallback: lhs.createdAt) > sortDate(rhs.startedAt, fallback: rhs.createdAt)
			}
	}

	static func fetchRecording(id: String) throws -> ListenRecordingDetail {
		guard let summary = try listRecordings().first(where: { $0.id == id }) else {
			throw LocalRecordingsError.notFound
		}
		let directory = URL(fileURLWithPath: summary.dir, isDirectory: true)
		let metadata = try readMetadata(directory: directory)
		let transcript = readTextFile(
			directory: directory,
			path: metadata.files.transcript,
			fallbackName: "transcript.txt",
		)
		let transcriptError: String? = transcript == nil
			? "No transcript is available for this recording."
			: nil
		let audioFile = resolveAudioFile(metadata: metadata, directory: directory)
		return ListenRecordingDetail(
			id: summary.id,
			dir: summary.dir,
			metadata: ListenRecordingMetadata(
				id: metadata.id,
				name: metadata.name,
				description: metadata.description,
				createdAt: metadata.createdAt,
				startedAt: metadata.startedAt,
				stoppedAt: metadata.stoppedAt,
				durationMs: metadata.durationMs,
				sources: metadata.sources,
				errors: metadata.errors,
			),
			hasAudio: audioFile != nil,
			audioPath: audioFile?.path,
			hasTranscript: transcript != nil,
			transcript: transcript,
			transcriptError: transcriptError,
			warnings: nil,
		)
	}

	private static func recordingsDirectory() -> URL {
		FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent(".toby", isDirectory: true)
			.appendingPathComponent("listen", isDirectory: true)
			.appendingPathComponent("recordings", isDirectory: true)
	}

	private static func readMetadata(directory: URL) throws -> LocalRecordingMetadata {
		let data = try Data(contentsOf: directory.appendingPathComponent("metadata.json"))
		var metadata = try JSONDecoder().decode(LocalRecordingMetadata.self, from: data)
		if metadata.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			metadata.id = directory.lastPathComponent
		}
		return metadata
	}

	private static func hasAudio(metadata: LocalRecordingMetadata, directory: URL) -> Bool {
		resolveAudioFile(metadata: metadata, directory: directory) != nil
	}

	private static func resolveAudioFile(metadata: LocalRecordingMetadata, directory: URL) -> URL? {
		resolveFile(directory: directory, path: metadata.files.combined, fallbackName: "combined.m4a")
			?? resolveFile(directory: directory, path: metadata.files.mic, fallbackName: "mic.wav")
			?? resolveFile(directory: directory, path: metadata.files.system, fallbackName: "system.wav")
	}

	private static func hasTranscript(metadata: LocalRecordingMetadata, directory: URL) -> Bool {
		guard let text = readTextFile(
			directory: directory,
			path: metadata.files.transcript,
			fallbackName: "transcript.txt",
		) else { return false }
		return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	private static func readTextFile(directory: URL, path: String?, fallbackName: String) -> String? {
		guard let url = resolveFile(directory: directory, path: path, fallbackName: fallbackName),
			let text = try? String(contentsOf: url, encoding: .utf8)
		else { return nil }
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}

	private static func resolveFile(directory: URL, path: String?, fallbackName: String) -> URL? {
		if let path, !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : directory.appendingPathComponent(path)
			if FileManager.default.fileExists(atPath: url.path) {
				return url
			}
		}
		let fallback = directory.appendingPathComponent(fallbackName)
		return FileManager.default.fileExists(atPath: fallback.path) ? fallback : nil
	}

	private static func sortDate(_ value: String, fallback: String) -> Date {
		isoDate(value)
			?? isoDate(fallback)
			?? .distantPast
	}

	private static func isoDate(_ value: String) -> Date? {
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
	}
}

private struct LocalRecordingMetadata: Decodable {
	var id: String
	let name: String?
	let description: String?
	let createdAt: String
	let startedAt: String
	let stoppedAt: String?
	let durationMs: Int?
	let sources: ListenSourceSelection
	let files: LocalRecordingFiles
	let errors: [String]?
}

private struct LocalRecordingFiles: Decodable {
	let mic: String?
	let system: String?
	let combined: String?
	let transcript: String?
	let transcriptJson: String?
}

private enum LocalRecordingsError: LocalizedError {
	case notFound

	var errorDescription: String? {
		switch self {
		case .notFound:
			return "Recording not found."
		}
	}
}
