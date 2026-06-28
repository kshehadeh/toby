import SwiftUI

struct ConfigureBlockFieldView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem
	let sectionLabel: String

	var body: some View {
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
						.scrollContentBackground(.hidden)
						.frame(minHeight: 140)
						.padding(10)
						.background(
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.fill(SettingsDesign.canvasBackground.opacity(0.55))
						)
						.overlay {
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.stroke(SettingsDesign.controlBorder, lineWidth: 1)
						}
				} else if field.readOnly == true {
					Text(store.value(for: field.key).isEmpty ? "Not set" : "Configured")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
				} else if field.kind == .image {
					PersonaImageFieldView(store: store, field: field)
				}
			}
			.padding(SettingsDesign.rowHorizontalPadding)
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
