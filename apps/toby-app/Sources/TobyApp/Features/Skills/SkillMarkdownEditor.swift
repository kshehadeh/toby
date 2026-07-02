import SwiftUI

/// The centerpiece markdown editor for the skill inspector: syntax-highlighted
/// write mode, rendered preview, a formatting toolbar, and a status footer.
struct SkillMarkdownEditor: View {
	@Binding var text: String
	@State private var isPreview = false
	@StateObject private var model = SkillMarkdownEditorModel()

	var body: some View {
		VStack(spacing: 0) {
			header
			Divider().overlay(SettingsDesign.cardBorder)
			editorBody
			Divider().overlay(SettingsDesign.cardBorder)
			footer
		}
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}

	private var header: some View {
		HStack(spacing: 10) {
			Picker("Mode", selection: $isPreview) {
				Text("Write").tag(false)
				Text("Preview").tag(true)
			}
			.pickerStyle(.segmented)
			.labelsHidden()
			.frame(width: 168)

			Divider().frame(height: 18).overlay(SettingsDesign.cardBorder)

			HStack(spacing: 4) {
				toolbarButton("Bold", systemImage: "bold", format: .bold)
				toolbarButton("Italic", systemImage: "italic", format: .italic)
				toolbarButton("Code", systemImage: "chevron.left.forwardslash.chevron.right", format: .code)
				toolbarButton("List", systemImage: "list.bullet", format: .list)
				toolbarButton("Quote", systemImage: "text.quote", format: .quote)
			}
			.disabled(isPreview)
			.opacity(isPreview ? 0.4 : 1)

			Spacer(minLength: 8)
		}
		.padding(.horizontal, 14)
		.padding(.vertical, 8)
	}

	private func toolbarButton(
		_ label: String,
		systemImage: String,
		format: SkillMarkdownFormat,
	) -> some View {
		Button {
			model.format(format)
		} label: {
			Image(systemName: systemImage)
				.font(.system(size: 12, weight: .medium))
				.frame(width: 24, height: 22)
		}
		.buttonStyle(.borderless)
		.foregroundStyle(SettingsDesign.rowTitle)
		.help(label)
		.accessibilityLabel(label)
	}

	@ViewBuilder
	private var editorBody: some View {
		if isPreview {
			ScrollView {
				MarkdownText(
					text: text,
					font: .body,
					foregroundStyle: SettingsDesign.rowTitle,
				)
				.padding(.horizontal, 18)
				.padding(.vertical, 16)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			SkillMarkdownTextView(text: $text, model: model)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private var footer: some View {
		HStack(spacing: 8) {
			Text("Markdown")
			Text("·")
			Text("\(wordCount) words")
			Text("·")
			Text("Ln \(model.line), Col \(model.column)")
			Spacer()
		}
		.font(.caption.monospaced())
		.foregroundStyle(SettingsDesign.rowDescription)
		.padding(.horizontal, 14)
		.padding(.vertical, 6)
	}

	private var wordCount: Int {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return 0 }
		return trimmed.split(whereSeparator: { $0.isWhitespace }).count
	}
}
