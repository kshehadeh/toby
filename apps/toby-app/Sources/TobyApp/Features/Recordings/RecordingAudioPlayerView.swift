import AVFoundation
import SwiftUI

struct RecordingAudioPlayerView: View {
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
final class RecordingAudioPlayer {
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
