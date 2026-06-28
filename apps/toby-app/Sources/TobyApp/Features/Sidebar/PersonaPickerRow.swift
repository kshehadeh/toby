import SwiftUI

struct PersonaPickerRow: View {
	let persona: PersonaOption
	let isCurrent: Bool
	let isSaving: Bool
	let isHovered: Bool
	let onHoverChange: (Bool) -> Void
	let onSelect: () -> Void
	let onEdit: () -> Void

	var body: some View {
		HStack(spacing: 4) {
			Button {
				onSelect()
			} label: {
				HStack(spacing: 8) {
					if let imageUrlString = persona.imageUrl,
						let imageUrl = URL(string: ConfigReader.baseURL().absoluteString + imageUrlString)
					{
						PersonaImageView(url: imageUrl, size: 22)
					} else {
						PersonaImageView(url: ConfigReader.baseURL().appendingPathComponent("api/personas/image/default.png"), size: 22)
					}
					Text(persona.label)
						.lineLimit(1)
					Spacer(minLength: 0)
					if isCurrent {
						Image(systemName: "checkmark")
							.accessibilityLabel("Selected")
							.foregroundStyle(AppTheme.accent)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.disabled(isSaving)

			if persona.isBuiltIn != true {
				Button {
					onEdit()
				} label: {
					Image(systemName: "pencil")
						.font(.caption.weight(.semibold))
						.foregroundStyle(isHovered ? AppTheme.primaryText : AppTheme.tertiaryText)
						.frame(width: 22, height: 22)
						.background(
							RoundedRectangle(cornerRadius: 5)
								.fill(isHovered ? AppTheme.selection : Color.clear)
						)
						.overlay {
							RoundedRectangle(cornerRadius: 5)
								.stroke(isHovered ? SettingsDesign.controlBorder : Color.clear, lineWidth: 1)
						}
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Edit \(persona.label)")
				.disabled(isSaving)
				.opacity(isHovered ? 1 : 0)
				.animation(.easeInOut(duration: 0.15), value: isHovered)
			}
		}
		.padding(.horizontal, 6)
		.padding(.vertical, 5)
		.onHover { onHoverChange($0) }
	}
}
