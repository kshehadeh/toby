import SwiftUI

/// Header skill icon that opens the image picker. Hover shows an edit overlay
/// so the control reads as tappable; a custom icon can be reset from the
/// context menu.
struct EditableSkillIcon: View {
	let iconURL: URL?
	var hasCustomIcon: Bool
	var isDisabled: Bool
	var onChoose: () -> Void
	var onReset: () -> Void

	@State private var isHovered = false
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private let size: CGFloat = 48
	private let cornerRadius: CGFloat = 12

	var body: some View {
		Button(action: onChoose) {
			SkillIconView(iconURL: iconURL, size: size, cornerRadius: cornerRadius)
				.overlay {
					RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
						.fill(Color.black.opacity(showsOverlay ? 0.45 : 0))
					Image(systemName: "square.and.pencil")
						.font(.system(size: 16, weight: .semibold))
						.foregroundStyle(.white)
						.opacity(showsOverlay ? 1 : 0)
						.accessibilityHidden(true)
				}
				.clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
		}
		.buttonStyle(.plain)
		.disabled(isDisabled)
		.pointerStyle(.link)
		.onHover { isHovered = $0 }
		.animation(reduceMotion ? nil : .easeInOut(duration: 0.14), value: isHovered)
		.help("Change icon")
		.accessibilityLabel("Change icon")
		.accessibilityIdentifier("skill-icon-edit-button")
		.contextMenu {
			if hasCustomIcon {
				Button("Reset to Default", role: .destructive) {
					onReset()
				}
			}
		}
	}

	private var showsOverlay: Bool {
		isHovered && !isDisabled
	}
}
