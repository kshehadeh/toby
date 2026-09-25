import SwiftUI

/// Small uppercase capsule for a status or language label — the language
/// tag on a script tool's code editor, a "beta" flag, a count. Three tones,
/// matching the Toby Design System's `Badge` component: `neutral` (quiet,
/// default), `accent` (filled, reserve for a single emphasized label per
/// view), `accentSoft` (tinted, the common case — visible without competing
/// with the accent's other uses).
struct Badge: View {
	enum Tone {
		case neutral
		case accent
		case accentSoft
	}

	let text: String
	var tone: Tone = .neutral

	var body: some View {
		Text(text)
			.font(.system(size: 9, weight: .bold))
			.tracking(0.4)
			.textCase(.uppercase)
			.foregroundStyle(foreground)
			.padding(.horizontal, 7)
			.padding(.vertical, 3)
			.background(background, in: Capsule())
			.overlay {
				Capsule().stroke(border, lineWidth: 1)
			}
			.accessibilityAddTraits(.isStaticText)
	}

	private var background: Color {
		switch tone {
		case .neutral: AppTheme.tertiaryText.opacity(0.12)
		case .accent: AppTheme.accent
		case .accentSoft: AppTheme.accent.opacity(0.10)
		}
	}

	private var border: Color {
		switch tone {
		case .neutral: AppTheme.tertiaryText.opacity(0.30)
		case .accent: .clear
		case .accentSoft: AppTheme.accent.opacity(0.25)
		}
	}

	private var foreground: Color {
		switch tone {
		case .neutral: AppTheme.tertiaryText
		case .accent: Color.black.opacity(0.85) // --text-on-accent
		case .accentSoft: AppTheme.accent
		}
	}
}
