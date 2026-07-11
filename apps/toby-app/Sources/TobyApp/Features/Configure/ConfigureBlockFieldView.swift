import SwiftUI

struct ConfigureBlockFieldView: View {
	@Bindable var store: ConfigureStore
	let field: SettingsItem
	let sectionLabel: String

	var body: some View {
		if field.kind == .hint, isTipHint {
			tipHintCard
		} else {
			standardBlock
		}
	}

	/// Message-only hints (no separate current value) get the tip treatment —
	/// e.g. transcription OpenAI reuse note, web search provider description.
	private var isTipHint: Bool {
		let value = (field.currentValue ?? store.value(for: field.key))
			.trimmingCharacters(in: .whitespacesAndNewlines)
		return value.isEmpty
	}

	private var tipMessage: String {
		field.label
	}

	/// Amber/gold tip card with a large rotated lightbulb stamp (dashboard-style).
	private var tipHintCard: some View {
		Text(tipMessage)
			.font(.body)
			.foregroundStyle(Color.white.opacity(0.92))
			.textSelection(.enabled)
			.fixedSize(horizontal: false, vertical: true)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.leading, 36)
			.padding(.trailing, SettingsDesign.rowHorizontalPadding + 6)
			.padding(.vertical, SettingsDesign.rowVerticalPadding + 10)
			.background(
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.fill(
						LinearGradient(
							colors: [
								Color(red: 0.42, green: 0.28, blue: 0.08).opacity(0.95),
								Color(red: 0.28, green: 0.18, blue: 0.06).opacity(0.95),
								Color(red: 0.18, green: 0.14, blue: 0.08).opacity(0.98),
							],
							startPoint: .topLeading,
							endPoint: .bottomTrailing
						)
					)
			)
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.stroke(
						LinearGradient(
							colors: [
								Color(red: 0.96, green: 0.72, blue: 0.28).opacity(0.55),
								Color(red: 0.96, green: 0.62, blue: 0.12).opacity(0.18),
							],
							startPoint: .topLeading,
							endPoint: .bottomTrailing
						),
						lineWidth: 1
					)
			}
			.overlay(alignment: .topLeading) {
				// Large decorative stamp that straddles the card border.
				Image(systemName: "lightbulb.fill")
					.font(.system(size: 48, weight: .semibold))
					.symbolRenderingMode(.hierarchical)
					.foregroundStyle(
						LinearGradient(
							colors: [
								Color(red: 1.0, green: 0.88, blue: 0.35),
								Color(red: 0.96, green: 0.62, blue: 0.12),
							],
							startPoint: .top,
							endPoint: .bottom
						)
					)
					.rotationEffect(.degrees(-30))
					.shadow(color: .black.opacity(0.45), radius: 10, x: 1, y: 3)
					.offset(x: -14, y: -18)
					.allowsHitTesting(false)
					.accessibilityHidden(true)
			}
			// Room so the overhanging icon isn't clipped by the scroll view.
			.padding(.top, 18)
			.padding(.leading, 14)
			.accessibilityElement(children: .combine)
			.accessibilityIdentifier("configure-tip-hint")
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
