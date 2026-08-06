import SwiftUI

struct ActivePulseIcon: View {
	var color: Color = .green
	/// Larger rings, brighter glow, and a scaled core — use for always-visible
	/// status like the recording indicator next to the TOBY title.
	var isProminent: Bool = false
	@State private var pulse = false

	private var coreSize: CGFloat { isProminent ? 8 : 6 }
	private var layoutSize: CGFloat { isProminent ? 20 : 10 }

	var body: some View {
		ZStack {
			if isProminent {
				// Outer halo — expands and fades in/out for a clear throb.
				Circle()
					.fill(color.opacity(pulse ? 0.45 : 0.12))
					.frame(width: coreSize, height: coreSize)
					.scaleEffect(pulse ? 2.5 : 1.35)
				// Mid ring stroke for definition against the sidebar background.
				Circle()
					.stroke(color.opacity(pulse ? 0.7 : 0.25), lineWidth: 1.5)
					.frame(width: coreSize, height: coreSize)
					.scaleEffect(pulse ? 1.9 : 1.15)
				// Core with soft bloom so it stays readable at rest.
				Circle()
					.fill(color)
					.frame(width: coreSize, height: coreSize)
					.scaleEffect(pulse ? 1.2 : 0.9)
					.shadow(color: color.opacity(pulse ? 0.9 : 0.45), radius: pulse ? 5 : 2)
			} else {
				Circle()
					.fill(color.opacity(pulse ? 0.25 : 0.0))
					.frame(width: pulse ? 10 : 6, height: pulse ? 10 : 6)
				Circle()
					.fill(color)
					.frame(width: 6, height: 6)
			}
		}
		.frame(width: layoutSize, height: layoutSize)
		.onAppear {
			let duration = isProminent ? 0.7 : 0.8
			withAnimation(.easeInOut(duration: duration).repeatForever(autoreverses: true)) {
				pulse = true
			}
		}
		.onDisappear {
			pulse = false
		}
	}
}
