import SwiftUI

struct LiveRecordingTranscriptView: View {
	let transcript: LiveTranscriptSnapshot
	@State private var followsLatest = true
	@State private var isUserScrolling = false

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Label("Live transcript · On device", systemImage: "text.bubble")
				.font(.headline)
			if let error = transcript.error {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
			if transcript.segments.isEmpty {
				Text(transcript.error == nil ? transcript.message : "Audio will be available after you stop recording.")
					.foregroundStyle(.secondary)
					.frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
			} else {
				ScrollViewReader { proxy in
					ScrollView {
						LazyVStack(alignment: .leading, spacing: 12) {
							ForEach(transcript.segments) { segment in
								VStack(alignment: .leading, spacing: 3) {
									Text(segment.source == "mic" ? "Microphone" : "System audio")
										.font(.caption).foregroundStyle(.secondary)
									Text(segment.text)
										.foregroundStyle(segment.isFinal ? .primary : .secondary)
										.textSelection(.enabled)
								}
								.frame(maxWidth: .infinity, alignment: .leading)
							}
							Color.clear.frame(height: 1).id("latest")
						}
					}
					.onScrollGeometryChange(for: Bool.self) { geometry in
						geometry.contentSize.height - geometry.visibleRect.maxY < 60
					} action: { _, nearBottom in
						// Content growth must not be mistaken for scrolling away.
						if isUserScrolling { followsLatest = nearBottom }
					}
					.onScrollPhaseChange { _, phase in isUserScrolling = phase.isScrolling }
					.onAppear { proxy.scrollTo("latest", anchor: .bottom) }
					.onChange(of: transcript.segments) {
						if followsLatest { proxy.scrollTo("latest", anchor: .bottom) }
					}
				}
				.frame(minHeight: 140, maxHeight: .infinity)
			}
		}
		.frame(maxWidth: 720, alignment: .leading)
		.accessibilityIdentifier("live-recording-transcript")
	}
}
