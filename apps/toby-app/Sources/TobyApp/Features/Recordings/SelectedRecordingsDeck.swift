import SwiftUI

struct SelectedRecordingsDeck: View {
	let recordings: [ListenRecordingSummary]

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			Text("\(recordings.count) recordings selected")
				.font(.title3.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)

			if recordings.count <= 5 {
				ZStack(alignment: .topLeading) {
					ForEach(Array(recordings.enumerated()), id: \.element.id) { index, recording in
						RecordingSelectionCard(recording: recording)
							.offset(x: CGFloat(index) * 16, y: CGFloat(index) * 12)
							.zIndex(Double(index))
					}
				}
				.frame(minHeight: 160)
			} else {
				ScrollView(.horizontal, showsIndicators: false) {
					HStack(spacing: 12) {
						ForEach(recordings) { recording in
							RecordingSelectionCard(recording: recording)
						}
					}
				}
			}
		}
	}
}
