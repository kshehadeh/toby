import SwiftUI

/// Shared layout tokens for home-dashboard blocks (mail, tasks, calendar, flows).
enum DashboardBlockLayout {
	/// Collapsed height for informational cards so a row aligns.
	static let collapsedHeight: CGFloat = 340
	/// Soft fade over clipped body text (fully opaque at the bottom of the fade).
	static let showMoreFadeHeight: CGFloat = 40
	/// Solid control bar under the fade, overlaid on the card’s lower edge.
	static let showMoreButtonHeight: CGFloat = 36
	static var showMoreChromeHeight: CGFloat {
		showMoreFadeHeight + showMoreButtonHeight
	}

	/// Inset matching the design-system `DashboardCard` (26px).
	static let cardPadding: CGFloat = 26
	static let headerSpacing: CGFloat = 18
	/// Large light title so the card name leads by scale, not weight.
	static let titleSize: CGFloat = 22
	static let titleWeight: Font.Weight = .light
	/// ~−0.02em at 22pt — large light SF Pro reads tighter than default.
	static let titleTracking: CGFloat = -0.44
	static let capRuleHeight: CGFloat = 2
	static let capRuleOpacity: Double = 0.85
	static let ghostGlyphSize: CGFloat = 120
	static let ghostGlyphOpacity: Double = 0.045
	/// Inset from the card’s lower-right edges so the glyph does not kiss the clip.
	static let ghostGlyphInset: CGFloat = 5
	static let expandedShadowRadius: CGFloat = 12
	static let expandedShadowY: CGFloat = 6
	static let expandedShadowOpacity: Double = 0.18
}

/// Flat panel, 2px accent cap rule, optional ghost glyph. No border, no divider.
struct DashboardBlockChrome: ViewModifier {
	var systemImage: String? = nil
	var isExpanded: Bool = false

	func body(content: Content) -> some View {
		content
			.background {
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
					.fill(AppTheme.panelBackground)
			}
			.overlay(alignment: .top) {
				DashboardCapRule()
			}
			.overlay(alignment: .bottomTrailing) {
				if let systemImage {
					DashboardGhostGlyph(systemImage: systemImage)
				}
			}
			.compositingGroup()
			.clipShape(RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous))
			.shadow(
				color: isExpanded
					? Color.black.opacity(DashboardBlockLayout.expandedShadowOpacity)
					: .clear,
				radius: isExpanded ? DashboardBlockLayout.expandedShadowRadius : 0,
				x: 0,
				y: isExpanded ? DashboardBlockLayout.expandedShadowY : 0
			)
	}
}

extension View {
	func dashboardBlockChrome(systemImage: String? = nil, isExpanded: Bool = false) -> some View {
		modifier(DashboardBlockChrome(systemImage: systemImage, isExpanded: isExpanded))
	}
}

/// 2px accent rule capping the card, inset with the card padding so it
/// clears the rounded corners.
private struct DashboardCapRule: View {
	var body: some View {
		Rectangle()
			.fill(AppTheme.accent.opacity(DashboardBlockLayout.capRuleOpacity))
			.frame(height: DashboardBlockLayout.capRuleHeight)
			.padding(.horizontal, DashboardBlockLayout.cardPadding)
			.allowsHitTesting(false)
			.accessibilityHidden(true)
	}
}

/// Oversized flat glyph in the lower-right corner at 4.5% opacity.
private struct DashboardGhostGlyph: View {
	let systemImage: String

	var body: some View {
		Image(systemName: systemImage)
			.font(.system(size: DashboardBlockLayout.ghostGlyphSize, weight: .ultraLight))
			.symbolRenderingMode(.monochrome)
			.foregroundStyle(AppTheme.primaryText.opacity(DashboardBlockLayout.ghostGlyphOpacity))
			.padding(.trailing, DashboardBlockLayout.ghostGlyphInset)
			.padding(.bottom, DashboardBlockLayout.ghostGlyphInset)
			.allowsHitTesting(false)
			.accessibilityHidden(true)
	}
}
