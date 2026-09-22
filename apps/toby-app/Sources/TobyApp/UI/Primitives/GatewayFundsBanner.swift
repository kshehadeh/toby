import SwiftUI

/// Durable window banner for a gateway that has run out of funds.
/// Stays until the user closes it. Opening Settings does not dismiss it.
struct GatewayFundsBanner: View {
	let notice: GatewayFundsNotice
	let onOpenSettings: (String) -> Void
	let onClose: () -> Void

	var body: some View {
		HStack(alignment: .top, spacing: 12) {
			Image(systemName: "exclamationmark.triangle.fill")
				.font(.title3.weight(.semibold))
				.foregroundStyle(AppTheme.statusErrorForeground)
				.accessibilityHidden(true)

			VStack(alignment: .leading, spacing: 4) {
				Text(notice.title)
					.font(.subheadline.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
					.fixedSize(horizontal: false, vertical: true)
				Text(notice.message)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.accessibilityElement(children: .combine)

			Button("Open Settings") {
				onOpenSettings(notice.settingsNavKey)
			}
			.buttonStyle(.bordered)
			.controlSize(.small)

			Button(action: onClose) {
				Image(systemName: "xmark")
					.font(.caption.weight(.bold))
					.foregroundStyle(AppTheme.tertiaryText)
					.frame(width: 22, height: 22)
					.contentShape(Circle())
			}
			.buttonStyle(.plain)
			.help("Close")
			.accessibilityLabel("Close")
		}
		.padding(.horizontal, 14)
		.padding(.vertical, 12)
		.frame(maxWidth: 560)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
				.fill(AppTheme.statusErrorBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
				.stroke(AppTheme.statusErrorBorder, lineWidth: 1)
		)
		.accessibilityElement(children: .contain)
		.onAppear { announce() }
		.onChange(of: notice) { _, _ in announce() }
	}

	private func announce() {
		AccessibilityNotification.Announcement("\(notice.title). \(notice.message)").post()
	}
}
