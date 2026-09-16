import SwiftUI

/// Tokens for the Apple Intelligence / Siri rainbow outline.
enum IntelligenceOutline {
	static let fadeDuration: TimeInterval = 0.3
	static let defaultAccessibilityIdentifier = "intelligence-outline"
	/// Saturated hues so the band reads on both light and dark surfaces.
	static let colors: [Color] = [
		Color(hue: 0.55, saturation: 0.90, brightness: 1.0),
		Color(hue: 0.73, saturation: 0.85, brightness: 1.0),
		Color(hue: 0.92, saturation: 0.88, brightness: 1.0),
		Color(hue: 0.08, saturation: 0.92, brightness: 1.0),
		Color(hue: 0.13, saturation: 0.90, brightness: 1.0),
		Color(hue: 0.55, saturation: 0.90, brightness: 1.0),
	]
}

/// Fades a Siri-style rainbow ring over the view while `isActive`.
///
/// Apply **after** `clipShape` so bloom is not cropped. Processing-state
/// exception to the quiet content-surface rule: idle views stay undecorated.
struct IntelligenceOutlineModifier<S: Shape>: ViewModifier {
	var isActive: Bool
	var shape: S
	var accessibilityIdentifier: String

	func body(content: Content) -> some View {
		content.overlay {
			IntelligenceOutlineRing(
				isActive: isActive,
				shape: shape,
				accessibilityIdentifier: accessibilityIdentifier
			)
		}
	}
}

/// Drawing follows the GlowEffectKit / Aurora pattern: turn a stroke into a
/// filled path, then layer a blur. `Shape.stroke(AngularGradient, lineWidth:)`
/// does not paint reliably as an overlay on macOS 26.
private struct IntelligenceOutlineRing<S: Shape>: View {
	var isActive: Bool
	var shape: S
	var accessibilityIdentifier: String

	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.colorSchemeContrast) private var contrast

	private var coreWidth: CGFloat { contrast == .increased ? 4 : 3 }
	private var bloomWidth: CGFloat { contrast == .increased ? 12 : 8 }
	private var fade: Animation? {
		reduceMotion ? nil : .easeInOut(duration: IntelligenceOutline.fadeDuration)
	}

	var body: some View {
		GeometryReader { proxy in
			let frame = CGSize(width: proxy.size.width, height: proxy.size.height)
			if reduceMotion {
				ring(angle: .degrees(0))
					.frame(width: frame.width, height: frame.height)
			} else {
				TimelineView(
					.animation(minimumInterval: 1.0 / 30.0, paused: !isActive)
				) { context in
					let seconds = context.date.timeIntervalSinceReferenceDate
					let turns = seconds.truncatingRemainder(dividingBy: 3) / 3
					ring(angle: .degrees(turns * 360))
						.frame(width: frame.width, height: frame.height)
				}
			}
		}
		.opacity(isActive ? 1 : 0)
		.animation(fade, value: isActive)
		.allowsHitTesting(false)
		.accessibilityIdentifier(isActive ? accessibilityIdentifier : "")
		.accessibilityHidden(true)
	}

	private func ring(angle: Angle) -> some View {
		let gradient = AngularGradient(
			colors: IntelligenceOutline.colors,
			center: .center,
			startAngle: angle,
			endAngle: angle + .degrees(360)
		)
		return shape
			.stroke(style: StrokeStyle(lineWidth: coreWidth, lineCap: .round))
			.fill(gradient)
			.overlay {
				shape
					.stroke(style: StrokeStyle(lineWidth: bloomWidth, lineCap: .round))
					.fill(gradient)
					.blur(radius: 10)
					.opacity(0.85)
			}
			.overlay {
				shape
					.stroke(style: StrokeStyle(lineWidth: bloomWidth / 2, lineCap: .round))
					.fill(gradient)
					.blur(radius: 4)
			}
	}
}

extension View {
	/// Siri-style rainbow outline on a continuous rounded rect.
	///
	/// Bind `isActive` to a real processing state (refresh, stream, generate).
	/// Apply after clipping so the bloom can sit on the edge.
	func intelligenceOutline(
		isActive: Bool,
		cornerRadius: CGFloat = AppTheme.cornerRadius,
		accessibilityIdentifier: String = IntelligenceOutline.defaultAccessibilityIdentifier
	) -> some View {
		intelligenceOutline(
			isActive: isActive,
			in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
			accessibilityIdentifier: accessibilityIdentifier
		)
	}

	/// Siri-style rainbow outline following an arbitrary shape (capsule, circle,
	/// concentric rect, custom path).
	func intelligenceOutline<S: Shape>(
		isActive: Bool,
		in shape: S,
		accessibilityIdentifier: String = IntelligenceOutline.defaultAccessibilityIdentifier
	) -> some View {
		modifier(
			IntelligenceOutlineModifier(
				isActive: isActive,
				shape: shape,
				accessibilityIdentifier: accessibilityIdentifier
			)
		)
	}
}
