import SwiftUI

/// 30pt rounded tile for a flow step: the integration's own icon on white
/// when it has one, otherwise an SF Symbol on a quiet fill (accent for AI).
struct FlowStepIconTile: View {
	let iconURL: URL?
	let systemImage: String
	var isAccent: Bool = false

	var body: some View {
		let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
		ZStack {
			shape.fill(fill)
			if let iconURL {
				AsyncImage(url: iconURL) { phase in
					switch phase {
					case .success(let image):
						image
							.resizable()
							.scaledToFit()
							.frame(width: 18, height: 18)
					default:
						symbol
					}
				}
			} else {
				symbol
			}
		}
		.frame(width: 30, height: 30)
		.overlay {
			if !isAccent {
				shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
		}
		.accessibilityHidden(true)
	}

	private var fill: Color {
		if isAccent { return AppTheme.accent.opacity(0.18) }
		return iconURL == nil ? AppTheme.primaryText.opacity(0.05) : .white
	}

	private var symbol: some View {
		Image(systemName: systemImage)
			.font(.system(size: 13, weight: .semibold))
			.foregroundStyle(isAccent ? AppTheme.accent : AppTheme.secondaryText)
	}
}
