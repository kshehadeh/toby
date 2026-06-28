import AppKit
import SwiftUI

struct AssistantRailColumn: View {
	let iconName: String
	var iconColor: Color? = nil
	var personaImage: URL? = nil

	var body: some View {
		VStack(spacing: 0) {
			if let personaImage {
				PersonaImageView(url: personaImage, size: 26)
					.overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(AppTheme.accent.opacity(0.4), lineWidth: 1))
			} else {
				Image(systemName: iconName)
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(iconColor ?? AppTheme.accent)
					.frame(width: 26, height: 26)
					.background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(AppTheme.panelBackground))
					.overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(AppTheme.accent.opacity(0.4), lineWidth: 1))
			}
			Rectangle()
				.fill(AppTheme.accent.opacity(0.35))
				.frame(width: 1.5)
				.frame(maxHeight: .infinity)
				.padding(.top, 6)
		}
		.frame(width: 34)
	}
}
