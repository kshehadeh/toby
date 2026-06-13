import SwiftUI

struct StatusLineView: View {
	let text: String
	let isLoading: Bool

	var body: some View {
		HStack(spacing: 8) {
			if isLoading {
				ProgressView()
					.controlSize(.small)
			}
			Text(text)
				.font(.caption)
				.foregroundStyle(.secondary)
				.lineLimit(1)
			Spacer()
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 6)
	}
}
