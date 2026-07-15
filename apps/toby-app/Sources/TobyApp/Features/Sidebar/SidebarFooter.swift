import SwiftUI

struct SidebarFooter: View {
	let status: AppStatus?
	@Binding var isPersonaPickerPresented: Bool
	/// Soft accent pulse around the persona control (e.g. onboarding CTA).
	var isAttentionHighlighted: Bool = false
	/// When true, the open popover emphasizes “Add New Persona…”.
	var emphasizeCreatePersona: Bool = false
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void

	@State private var attentionPulse = false

	var body: some View {
		Button {
			isPersonaPickerPresented = true
		} label: {
			HStack(alignment: .center, spacing: 8) {
				if let imageUrlString = status?.personaImageUrl,
					let imageUrl = URL(string: ConfigReader.baseURL().absoluteString + imageUrlString)
				{
					PersonaImageView(url: imageUrl, size: 32)
				} else {
					PersonaImageView(url: ConfigReader.baseURL().appendingPathComponent("api/personas/image/default.png"), size: 32)
				}
				VStack(alignment: .leading, spacing: 4) {
					Text(status?.persona ?? "Connecting")
						.font(.callout)
						.foregroundStyle(AppTheme.primaryText)
					Text(status?.model ?? "Waiting for daemon")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
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
		.padding(8)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(footerFill)
		)
		.overlay {
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(attentionStrokeColor, lineWidth: isAttentionHighlighted ? 2 : 0)
				.shadow(color: attentionGlowColor, radius: attentionPulse ? 14 : 8)
		}
		.scaleEffect(isAttentionHighlighted && attentionPulse ? 1.03 : 1.0)
		.animation(
			isAttentionHighlighted
				? .easeInOut(duration: 0.85).repeatForever(autoreverses: true)
				: .easeOut(duration: 0.25),
			value: attentionPulse
		)
		.animation(.easeOut(duration: 0.2), value: isAttentionHighlighted)
		.onChange(of: isAttentionHighlighted) { _, highlighted in
			if highlighted {
				attentionPulse = false
				// Kick the repeating pulse on the next runloop so animation attaches.
				DispatchQueue.main.async {
					attentionPulse = true
				}
			} else {
				attentionPulse = false
			}
		}
		.popover(isPresented: $isPersonaPickerPresented, arrowEdge: .bottom) {
			PersonaPickerPopover(
				currentPersona: status?.persona,
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
	}

	private var footerFill: Color {
		if isPersonaPickerPresented {
			return AppTheme.selection
		}
		if isAttentionHighlighted {
			return AppTheme.accent.opacity(attentionPulse ? 0.18 : 0.10)
		}
		return Color.clear
	}

	private var attentionStrokeColor: Color {
		guard isAttentionHighlighted else { return .clear }
		return AppTheme.accent.opacity(attentionPulse ? 0.95 : 0.45)
	}

	private var attentionGlowColor: Color {
		guard isAttentionHighlighted else { return .clear }
		return AppTheme.accent.opacity(attentionPulse ? 0.70 : 0.30)
	}
}
