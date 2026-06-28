import SwiftUI

struct SidebarFooter: View {
	let status: AppStatus?
	let onCreatePersona: () -> Void
	let onEditPersona: (String) -> Void
	let onPersonaSelected: () -> Void

	@State private var isPersonaPickerPresented = false

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
				.fill(isPersonaPickerPresented ? AppTheme.selection : Color.clear)
		)
		.popover(isPresented: $isPersonaPickerPresented, arrowEdge: .bottom) {
			PersonaPickerPopover(
				currentPersona: status?.persona,
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
	}
}
