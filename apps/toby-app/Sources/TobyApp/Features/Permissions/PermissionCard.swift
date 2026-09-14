import SwiftUI

struct PermissionCard: View {
	let status: PermissionStatus
	let onAllow: () async -> Void
	let onOpenSettings: () -> Void

	@State private var isRequesting = false

	var body: some View {
		HStack(alignment: .top, spacing: 16) {
			VStack {
				Image(systemName: status.kind.systemImage)
					.font(.system(size: 26, weight: .semibold))
					.symbolRenderingMode(.hierarchical)
					.foregroundStyle(status.kind.accentColor)
					.frame(width: 54, height: 54)
					.background(
						AppTheme.concentricRect(minimum: 14)
							.fill(status.kind.accentColor.opacity(0.16))
					)
					.overlay(
						AppTheme.concentricRect(minimum: 14)
							.stroke(status.kind.accentColor.opacity(0.35), lineWidth: 1)
					)
			}

			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 8) {
					Text(status.kind.title)
						.font(.headline)
						.foregroundStyle(AppTheme.primaryText)
					Spacer(minLength: 0)
					if status.isGranted {
						Image(systemName: "checkmark.circle.fill")
							.font(.title3)
							.foregroundStyle(Color.green)
					} else {
						Image(systemName: "xmark.circle.fill")
							.font(.title3)
							.foregroundStyle(Color.red)
					}
				}

				Text(status.kind.description)
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
					.fixedSize(horizontal: false, vertical: true)
					.multilineTextAlignment(.leading)

				if !status.isGranted {
					HStack(spacing: 8) {
						Button("Allow") {
							isRequesting = true
							Task {
								await onAllow()
								isRequesting = false
							}
						}
						.buttonStyle(.borderedProminent)
						.controlSize(.small)
						.disabled(isRequesting)

						Button("Open System Settings") {
							onOpenSettings()
						}
						.buttonStyle(.bordered)
						.controlSize(.small)
					}
					.padding(.top, 8)
				}
			}
		}
		.padding(AppTheme.contentPadding)
		.background(
			AppTheme.concentricRect(minimum: AppTheme.cornerRadius)
				.fill(AppTheme.panelBackground)
		)
		.overlay(
			AppTheme.concentricRect(minimum: AppTheme.cornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
	}
}
