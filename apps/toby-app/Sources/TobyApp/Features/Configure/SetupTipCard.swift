import SwiftUI

/// Shared amber-style tip card chrome, tinted with the user's accent preset.
enum SetupTipCardStyle {
	/// Dark base so body text stays readable over any accent.
	static var fillBase: Color { Color.black.opacity(0.72) }

	/// Accent wash layered on the base.
	static var fillAccent: LinearGradient {
		LinearGradient(
			colors: [
				AppTheme.accent.opacity(0.52),
				AppTheme.accent.opacity(0.30),
				AppTheme.accent.opacity(0.16),
			],
			startPoint: .topLeading,
			endPoint: .bottomTrailing
		)
	}

	static var border: LinearGradient {
		LinearGradient(
			colors: [
				AppTheme.accent.opacity(0.65),
				AppTheme.accent.opacity(0.22),
			],
			startPoint: .topLeading,
			endPoint: .bottomTrailing
		)
	}

	static var icon: LinearGradient {
		LinearGradient(
			colors: [
				Color.white.opacity(0.95),
				AppTheme.accent,
			],
			startPoint: .top,
			endPoint: .bottom
		)
	}

	static var link: LinearGradient {
		LinearGradient(
			colors: [
				Color.white.opacity(0.98),
				AppTheme.accent.opacity(0.95),
			],
			startPoint: .leading,
			endPoint: .trailing
		)
	}

	static var message: Color { Color.white.opacity(0.92) }
}

/// Tip blurb chrome: accent-tinted fill, border, and overhanging lightbulb stamp.
struct SetupTipCard<Content: View>: View {
	@Environment(\.tobyThemeEpoch) private var themeEpoch
	@ViewBuilder let content: Content

	var body: some View {
		content
			.padding(.leading, 36)
			.padding(.trailing, SettingsDesign.rowHorizontalPadding + 6)
			.padding(.vertical, SettingsDesign.rowVerticalPadding + 10)
			.background {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.fill(SetupTipCardStyle.fillBase)
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.fill(SetupTipCardStyle.fillAccent)
			}
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.stroke(SetupTipCardStyle.border, lineWidth: 1)
			}
			.overlay(alignment: .topLeading) {
				Image(systemName: "lightbulb.fill")
					.font(.system(size: 48, weight: .semibold))
					.symbolRenderingMode(.hierarchical)
					.foregroundStyle(SetupTipCardStyle.icon)
					.rotationEffect(.degrees(-30))
					.shadow(color: .black.opacity(0.45), radius: 10, x: 1, y: 3)
					.offset(x: -14, y: -18)
					.allowsHitTesting(false)
					.accessibilityHidden(true)
			}
			// Room so the overhanging icon isn't clipped by the scroll view.
			.padding(.top, 18)
			.padding(.leading, 14)
			// Re-tint when accent / scheme epoch changes.
			.id("setup-tip-card-\(themeEpoch)")
	}
}
