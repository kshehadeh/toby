import SwiftUI

struct MarkdownEditor: View {
	@Binding var text: String
	@State private var isPreview = false
	@FocusState private var isEditorFocused: Bool

	var body: some View {
		VStack(spacing: 0) {
			HStack(spacing: 8) {
				Picker("Mode", selection: $isPreview) {
					Text("Write").tag(false)
					Text("Preview").tag(true)
				}
				.pickerStyle(.segmented)
				.labelsHidden()
				.frame(width: 160)

				Spacer()

				Text("\(wordCount) words")
					.font(.caption)
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, 10)
			.background(SettingsDesign.cardBackground.opacity(0.5))
			.overlay(alignment: .bottom) {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
			}

			ZStack(alignment: .topLeading) {
				if isPreview {
					ScrollView {
						MarkdownText(
							text: text,
							font: .body,
							foregroundStyle: SettingsDesign.rowTitle
						)
						.padding(SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, 12)
						.frame(maxWidth: .infinity, alignment: .leading)
					}
				} else {
					TextEditor(text: $text)
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.scrollContentBackground(.hidden)
						.focused($isEditorFocused)
						.padding(10)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}

	private var wordCount: Int {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return 0 }
		return trimmed.split(separator: /\s+/).count
	}
}
