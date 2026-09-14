import SwiftUI

struct SidebarFooter: View {
	let status: AppStatus?
	@Binding var isPersonaPickerPresented: Bool
	/// Quiet accent emphasis around the persona control (e.g. onboarding CTA).
	var isAttentionHighlighted: Bool = false
	/// When true, the open popover emphasizes “Add New Persona…”.
	var emphasizeCreatePersona: Bool = false
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void

	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		Button {
			isPersonaPickerPresented = true
		} label: {
			HStack(alignment: .center, spacing: 8) {
				if let imageUrlString = status?.personaImageUrl,
					let imageUrl = URL(string: ConfigReader.baseURL().absoluteString + imageUrlString)
				{
					PersonaImageView(url: imageUrl, size: 24)
				} else {
					PersonaImageView(url: ConfigReader.baseURL().appendingPathComponent("api/personas/image/default.png"), size: 24)
				}
				Text(status?.persona ?? "Connecting")
					.font(.body)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Spacer(minLength: 0)
				Image(systemName: "chevron.up.chevron.down")
					.accessibilityLabel("Switch persona")
					.font(.caption2.weight(.semibold))
					.foregroundStyle(AppTheme.tertiaryText)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.padding(.horizontal, 8)
		.padding(.vertical, 6)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(footerFill)
		)
		.overlay {
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(attentionStrokeColor, lineWidth: isAttentionHighlighted ? 1.5 : 0)
		}
		.popover(isPresented: $isPersonaPickerPresented, arrowEdge: .bottom) {
			PersonaPickerPopover(
				currentPersona: status?.persona,
				model: status?.model,
				emphasizeCreate: emphasizeCreatePersona,
				onCreatePersona: {
					isPersonaPickerPresented = false
					onCreatePersona()
				},
				onEditPersona: { name in
					isPersonaPickerPresented = false
					onEditPersona(name)
				},
				onPersonaSelected: {
					isPersonaPickerPresented = false
					onPersonaSelected()
				},
			)
		}
		.accessibilityLabel("Persona")
		.accessibilityValue(status?.persona ?? "Connecting")
		.accessibilityIdentifier("sidebar-persona-footer")
		.accessibilityAddTraits(isAttentionHighlighted ? .isSelected : [])
		.accessibilityHint(isAttentionHighlighted ? "Set up a persona to finish onboarding" : "Switch persona")
	}

	private var footerFill: Color {
		if isPersonaPickerPresented {
			return Color.accentColor.opacity(0.14)
		}
		if isAttentionHighlighted {
			return AppTheme.accent.opacity(reduceMotion ? 0.12 : 0.16)
		}
		return Color.clear
	}

	private var attentionStrokeColor: Color {
		guard isAttentionHighlighted else { return .clear }
		return AppTheme.accent.opacity(reduceMotion ? 0.55 : 0.75)
	}
}
