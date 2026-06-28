import SwiftUI

struct ChangelogSkeletonView: View {
	@State private var pulse = false

	var body: some View {
		VStack(alignment: .leading, spacing: 24) {
			ForEach(0..<4) { index in
				VStack(alignment: .leading, spacing: 12) {
					HStack {
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(width: 120, height: 18)
						Spacer()
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(width: 80, height: 14)
					}
					VStack(alignment: .leading, spacing: 8) {
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(height: 14)
						RoundedRectangle(cornerRadius: 4)
							.fill(AppTheme.panelBackground)
							.frame(width: 240, height: 14)
					}
				}
				if index != 3 {
					Divider()
						.background(AppTheme.separator)
				}
			}
		}
		.opacity(pulse ? 0.5 : 1.0)
		.animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("changelog-skeleton")
	}
}
