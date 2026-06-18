import AVFoundation
import SwiftUI

struct RecordingsView: View {
	@Bindable var store: RecordingsStore
	@State private var pendingDeleteRecording: ListenRecordingSummary?
	@State private var isDeleteAlertPresented = false

	var body: some View {
		NavigationSplitView {
			RecordingsSidebarView(store: store, onDeleteRecording: confirmDelete)
				.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
		} detail: {
			RecordingsDetailView(store: store, onDeleteRecording: confirmDelete)
		}
		.frame(minWidth: 860, minHeight: 560)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.alert(
			"Delete Recording?",
			isPresented: $isDeleteAlertPresented,
			presenting: pendingDeleteRecording,
		) { recording in
			Button("Cancel", role: .cancel) {
				pendingDeleteRecording = nil
			}
			Button("Delete", role: .destructive) {
				pendingDeleteRecording = nil
				Task { await store.deleteRecording(id: recording.id) }
			}
		} message: { recording in
			Text("Are you sure you want to delete \"\(recordingSidebarTitle(recording))\"? This cannot be undone.")
		}
	}

	private func confirmDelete(_ recording: ListenRecordingSummary) {
		pendingDeleteRecording = recording
		isDeleteAlertPresented = true
	}
}

private struct RecordingsSidebarView: View {
	@Bindable var store: RecordingsStore
	let onDeleteRecording: (ListenRecordingSummary) -> Void

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 2) {
				if store.isLoading && store.recordings.isEmpty {
					Text("Loading recordings...")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(10)
				} else if store.recordings.isEmpty {
					Text("No recordings")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(10)
				} else {
					ForEach(store.recordings) { recording in
						Button {
							Task { await store.selectRecording(id: recording.id) }
						} label: {
							RecordingSidebarRow(
								recording: recording,
								isSelected: recording.id == store.selectedRecordingId,
							)
						}
						.buttonStyle(.plain)
						.contextMenu {
							Button("Delete Recording", systemImage: "trash", role: .destructive) {
								onDeleteRecording(recording)
							}
						}
					}
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(10)
		}
		.background(AppTheme.sidebarBackground)
	}
}

private struct RecordingSidebarRow: View {
	let recording: ListenRecordingSummary
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: recording.hasTranscript ? "doc.text" : "waveform")
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 18)
			VStack(alignment: .leading, spacing: 3) {
				Text(recordingSidebarTitle(recording))
					.font(.callout)
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(recordingSummary(recording))
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 7)
		.padding(.horizontal, 8)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? SettingsDesign.sidebarSelection : Color.clear)
		)
	}
}

private struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore
	let onDeleteRecording: (ListenRecordingSummary) -> Void

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isDetailLoading && store.detail == nil {
					ProgressView("Loading recording...")
						.frame(maxWidth: .infinity, minHeight: 240)
				} else if let detail = store.detail {
					RecordingDetailContent(detail: detail)
				} else if let errorMessage = store.errorMessage {
					ContentUnavailableView {
						Label("Recordings unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else {
					Text("Select a recording")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, store.detail != nil {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
		.toolbar {
			ToolbarItem(placement: .primaryAction) {
				if let recording = store.selectedRecording {
					Button("Delete Recording", systemImage: "trash", role: .destructive) {
						onDeleteRecording(recording)
					}
					.buttonStyle(.borderedProminent)
					.tint(.red)
					.disabled(store.deletingRecordingId != nil)
				}
			}
		}
	}
}

private struct RecordingDetailContent: View {
	let detail: ListenRecordingDetail

	private var visibleErrors: [String] {
		(detail.metadata.errors ?? []).filter { !isNonFatalScreenCaptureDecline($0) }
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			SettingsSectionHeader(title: detail.metadata.name ?? "Recording")
			SettingsCard {
				SettingsRow(title: "Started", description: detail.metadata.startedAt) {
					EmptyView()
				}
				SettingsRow(title: "Duration", description: durationText(detail.metadata.durationMs)) {
					EmptyView()
				}
				SettingsRow(title: "Sources", description: sourceText(detail.metadata.sources)) {
					EmptyView()
				}
				SettingsRow(title: "Location", description: detail.dir, showsDivider: false) {
					EmptyView()
				}
			}

			SettingsSectionHeader(title: "Audio")
			RecordingAudioPlayerView(detail: detail)

			SettingsSectionHeader(title: "Transcript")
			SettingsCard {
				Text(detail.transcript ?? detail.transcriptError ?? "Transcript not available.")
					.font(.body.monospaced())
					.foregroundStyle(detail.transcript == nil ? SettingsDesign.rowDescription : SettingsDesign.rowTitle)
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(SettingsDesign.rowHorizontalPadding)
			}

			if !visibleErrors.isEmpty {
				SettingsSectionHeader(title: "Errors")
				SettingsCard {
					Text(visibleErrors.joined(separator: "\n"))
						.font(.subheadline)
						.foregroundStyle(.red.opacity(0.85))
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
				}
			}
		}
	}
}

private struct RecordingAudioPlayerView: View {
	let detail: ListenRecordingDetail
	@State private var audioPlayer = RecordingAudioPlayer()
	private let timer = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

	var body: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				if detail.hasAudio, detail.audioPath != nil {
					HStack(spacing: 12) {
						Button {
							audioPlayer.togglePlayback()
						} label: {
							Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
								.frame(width: 14, height: 14)
								.foregroundStyle(SettingsDesign.rowTitle)
								.padding(9)
								.background(
									Circle()
										.fill(AppTheme.accent.opacity(0.28))
								)
						}
						.buttonStyle(.plain)
						.disabled(!audioPlayer.isReady)

						VStack(alignment: .leading, spacing: 6) {
							Slider(
								value: Binding(
									get: { audioPlayer.currentTime },
									set: { audioPlayer.seek(to: $0) },
								),
								in: 0 ... max(audioPlayer.duration, 1),
							)
							HStack {
								Text(playbackTimeText(audioPlayer.currentTime))
								Spacer()
								Text(playbackTimeText(audioPlayer.duration))
							}
							.font(.caption.monospacedDigit())
							.foregroundStyle(SettingsDesign.rowDescription)
						}
					}
				} else {
					Text("No audio file is available for this recording.")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = audioPlayer.errorMessage {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red.opacity(0.85))
						.fixedSize(horizontal: false, vertical: true)
				}
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)
		}
		.task(id: detail.audioPath ?? detail.id) {
			audioPlayer.load(audioPath: detail.audioPath)
		}
		.onReceive(timer) { _ in
			audioPlayer.refresh()
		}
		.onDisappear {
			audioPlayer.stop()
		}
	}
}

@Observable
@MainActor
private final class RecordingAudioPlayer {
	private var player: AVAudioPlayer?
	private var loadedAudioPath: String?
	var isPlaying = false
	var currentTime: TimeInterval = 0
	var duration: TimeInterval = 0
	var errorMessage: String?

	var isReady: Bool {
		player != nil && errorMessage == nil
	}

	func load(audioPath: String?) {
		guard loadedAudioPath != audioPath else { return }
		stop()
		loadedAudioPath = audioPath
		errorMessage = nil
		currentTime = 0
		duration = 0
		guard let audioPath else {
			player = nil
			return
		}
		do {
			let nextPlayer = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: audioPath))
			nextPlayer.prepareToPlay()
			player = nextPlayer
			duration = nextPlayer.duration
		} catch {
			player = nil
			errorMessage = "Could not load audio: \(error.localizedDescription)"
		}
	}

	func togglePlayback() {
		guard let player else { return }
		if player.isPlaying {
			player.pause()
			isPlaying = false
			refresh()
			return
		}
		if duration > 0, player.currentTime >= duration {
			player.currentTime = 0
		}
		player.play()
		isPlaying = true
		refresh()
	}

	func seek(to time: TimeInterval) {
		guard let player else { return }
		player.currentTime = min(max(time, 0), duration)
		refresh()
	}

	func refresh() {
		guard let player else {
			isPlaying = false
			currentTime = 0
			return
		}
		currentTime = player.currentTime
		duration = player.duration
		isPlaying = player.isPlaying
	}

	func stop() {
		player?.stop()
		player = nil
		isPlaying = false
		currentTime = 0
		duration = 0
	}
}

private func isNonFatalScreenCaptureDecline(_ message: String) -> Bool {
	message.contains("SCStreamErrorDomain")
		&& message.contains("Code=-3801")
		&& message.localizedCaseInsensitiveContains("declined")
}

private func recordingSummary(_ recording: ListenRecordingSummary) -> String {
	let duration = durationText(recording.durationMs)
	let transcript = recording.hasTranscript ? " · Transcript" : ""
	if hasRecordingName(recording) {
		let startedAt = friendlyRecordingDate(recording.startedAt, fallback: recording.createdAt)
		return "\(startedAt) · \(duration)\(transcript)"
	}
	return "\(duration)\(transcript)"
}

private func recordingSidebarTitle(_ recording: ListenRecordingSummary) -> String {
	if let name = normalizedRecordingName(recording) {
		return name
	}
	return friendlyRecordingDate(recording.startedAt, fallback: recording.createdAt)
}

private func hasRecordingName(_ recording: ListenRecordingSummary) -> Bool {
	normalizedRecordingName(recording) != nil
}

private func normalizedRecordingName(_ recording: ListenRecordingSummary) -> String? {
	guard let name = recording.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
		return nil
	}
	return name
}

private func friendlyRecordingDate(_ value: String, fallback: String) -> String {
	guard let date = isoRecordingDate(value) ?? isoRecordingDate(fallback) else {
		return value.isEmpty ? fallback : value
	}
	return RecordingDateFormatters.friendly.string(from: date)
}

private func isoRecordingDate(_ value: String) -> Date? {
	let fractional = ISO8601DateFormatter()
	fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private func durationText(_ durationMs: Int?) -> String {
	guard let durationMs else { return "Unknown duration" }
	let seconds = max(0, durationMs / 1000)
	let minutes = seconds / 60
	let remainder = seconds % 60
	return "\(minutes):\(String(format: "%02d", remainder))"
}

private func playbackTimeText(_ time: TimeInterval) -> String {
	let totalSeconds = max(0, Int(time.rounded()))
	let hours = totalSeconds / 3600
	let minutes = (totalSeconds % 3600) / 60
	let seconds = totalSeconds % 60
	if hours > 0 {
		return "\(hours):\(String(format: "%02d", minutes)):\(String(format: "%02d", seconds))"
	}
	return "\(minutes):\(String(format: "%02d", seconds))"
}

private enum RecordingDateFormatters {
	static let friendly: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .short
		return formatter
	}()
}

private func sourceText(_ sources: ListenSourceSelection) -> String {
	switch (sources.mic, sources.system) {
	case (true, true):
		return "Microphone + System audio"
	case (true, false):
		return "Microphone"
	case (false, true):
		return "System audio"
	default:
		return "None"
	}
}
