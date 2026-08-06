import SwiftUI

/// Semantic tone for inline status callouts (success / error banners).
enum InlineStatusTone {
	case success
	case error

	var background: Color {
		switch self {
		case .success: AppTheme.statusSuccessBackground
		case .error: AppTheme.statusErrorBackground
		}
	}

	var border: Color {
		switch self {
		case .success: AppTheme.statusSuccessBorder
		case .error: AppTheme.statusErrorBorder
		}
	}

	var foreground: Color {
		switch self {
		case .success: AppTheme.statusSuccessForeground
		case .error: AppTheme.statusErrorForeground
		}
	}

	var defaultSystemImage: String {
		switch self {
		case .success: "checkmark.circle.fill"
		case .error: "exclamationmark.triangle.fill"
		}
	}
}

/// Compact filled + outlined block for inline success/error messages.
/// Use for form feedback, health details, and non-empty-state error strips.
/// Prefer toasts for ephemeral global notices and `ContentUnavailableView` for full-page failures.
struct InlineStatusMessage: View {
	let message: String
	let tone: InlineStatusTone
	var systemImage: String? = nil
	var font: Font = .subheadline
	var allowsTextSelection: Bool = false

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: systemImage ?? tone.defaultSystemImage)
				.font(font.weight(.semibold))
				.foregroundStyle(tone.foreground)
				.frame(width: 14, alignment: .center)
				.padding(.top, 1)
			Group {
				if allowsTextSelection {
					Text(message)
						.font(font)
						.foregroundStyle(tone.foreground)
						.fixedSize(horizontal: false, vertical: true)
						.frame(maxWidth: .infinity, alignment: .leading)
						.textSelection(.enabled)
				} else {
					Text(message)
						.font(font)
						.foregroundStyle(tone.foreground)
						.fixedSize(horizontal: false, vertical: true)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
		.padding(.horizontal, 12)
		.padding(.vertical, 10)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius, style: .continuous)
				.fill(tone.background)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius, style: .continuous)
				.stroke(tone.border, lineWidth: 1)
		)
		.accessibilityElement(children: .combine)
	}
}
