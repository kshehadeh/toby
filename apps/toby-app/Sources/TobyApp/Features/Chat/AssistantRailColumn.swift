import AppKit
import SwiftUI

struct AssistantRailColumn: View {
	let iconName: String
	var iconColor: Color? = nil
	var personaImage: URL? = nil

	static let width: CGFloat = 34
	static let avatarSize: CGFloat = 26

	var body: some View {
		// Fixed-size avatar only. Do not use maxHeight: .infinity or GeometryReader
		// here — both cause layout thrash inside LazyVStack / ScrollView rows.
		Group {
			if let personaImage {
				PersonaImageView(url: personaImage, size: Self.avatarSize)
					.overlay(
						RoundedRectangle(cornerRadius: 4, style: .continuous)
							.stroke(AppTheme.accent.opacity(0.4), lineWidth: 1)
					)
			} else {
				Image(systemName: iconName)
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(iconColor ?? AppTheme.accent)
					.frame(width: Self.avatarSize, height: Self.avatarSize)
					.background(
						RoundedRectangle(cornerRadius: 4, style: .continuous)
							.fill(AppTheme.panelBackground)
					)
					.overlay(
						RoundedRectangle(cornerRadius: 4, style: .continuous)
							.stroke(AppTheme.accent.opacity(0.4), lineWidth: 1)
					)
			}
		}
		.frame(width: Self.width, height: Self.avatarSize, alignment: .top)
		.accessibilityHidden(true)
	}
}
