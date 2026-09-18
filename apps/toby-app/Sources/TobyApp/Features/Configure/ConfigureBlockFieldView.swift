import SwiftUI

struct ConfigureBlockFieldView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem
	let sectionLabel: String
	var usesFormChrome: Bool = false

	var body: some View {
		if field.kind == .hint, isTipHint {
			tipHintCard
		} else if usesFormChrome {
			formBlock
		} else {
			standardBlock
		}
	}

	private var formBlock: some View {
		Section {
			if field.kind == .hint {
				Text(field.currentValue ?? store.value(for: field.key))
					.textSelection(.enabled)
			} else if field.multiline == true {
				TextEditor(text: draftBinding)
					.font(.body.monospaced())
					.frame(minHeight: 140)
			} else if field.readOnly == true {
				LabeledContent(field.label) {
					Text(store.value(for: field.key).isEmpty ? "Not set" : "Configured")
						.foregroundStyle(.secondary)
				}
			} else if field.kind == .image {
				PersonaImageFieldView(store: store, field: field)
			}
		} header: {
			if field.kind != .hint, field.kind != .image {
				Text(field.label)
			}
		}
	}

	/// Message-only hints (no separate current value) get the tip treatment —
	/// e.g. transcription OpenAI reuse note, web search provider description.
	private var isTipHint: Bool {
		let value = (field.currentValue ?? store.value(for: field.key))
			.trimmingCharacters(in: .whitespacesAndNewlines)
		return value.isEmpty
	}

	private var tipHintCard: some View {
		SetupTipCard(
			tipId: field.key,
			title: field.label,
			accessibilityId: "configure-tip-hint"
		)
	}

	private var standardBlock: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				Text(field.label)
					.font(.body)
					.foregroundStyle(SettingsDesign.rowTitle)

				if field.kind == .hint {
					Text(field.currentValue ?? store.value(for: field.key))
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
				} else if field.multiline == true {
					TextEditor(text: draftBinding)
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.frame(minHeight: 140)
				} else if field.readOnly == true {
					Text(store.value(for: field.key).isEmpty ? "Not set" : "Configured")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
				} else if field.kind == .image {
					PersonaImageFieldView(store: store, field: field)
				}
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)
		}
	}

	private var draftBinding: Binding<String> {
		Binding(
			get: { store.value(for: field.key) },
			set: { store.setDraftValue(field.key, $0) },
		)
	}
}
