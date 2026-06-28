import SwiftUI

struct ActivePulseIcon: View {
	@State private var pulse = false

	var body: some View {
		ZStack {
			Circle()
				.fill(Color.green.opacity(pulse ? 0.25 : 0.0))
				.frame(width: pulse ? 10 : 6, height: pulse ? 10 : 6)
			Circle()
				.fill(Color.green)
				.frame(width: 6, height: 6)
		}
		.frame(width: 10, height: 10)
		.onAppear {
			withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
				pulse = true
			}
		}
		.onDisappear {
			pulse = false
		}
	}
}
