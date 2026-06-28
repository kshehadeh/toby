import SwiftUI

// MARK: - Skeleton loading placeholders

struct ConfigureSidebarSkeletonView: View {
	@State private var pulse = false

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			ForEach(0..<6, id: \.self) { _ in
				HStack(spacing: 12) {
					RoundedRectangle(cornerRadius: 4)
						.fill(SettingsDesign.cardBackground)
						.frame(width: 20, height: 20)
					RoundedRectangle(cornerRadius: 4)
						.fill(SettingsDesign.cardBackground)
						.frame(width: CGFloat.random(in: 80...140), height: 14)
					Spacer(minLength: 0)
				}
				.padding(.vertical, 8)
				.padding(.horizontal, 8)
			}
		}
		.opacity(pulse ? 0.45 : 1.0)
		.animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("settings-sidebar-skeleton")
	}
}
