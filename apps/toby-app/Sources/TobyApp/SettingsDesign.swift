import SwiftUI

enum SettingsDesign {
	static let canvasBackground = Color(red: 0.10, green: 0.10, blue: 0.11)
	static let cardBackground = Color(red: 0.16, green: 0.16, blue: 0.17)
	static let cardBorder = Color.white.opacity(0.07)
	static let sectionHeader = Color.white.opacity(0.45)
	static let rowTitle = Color.white.opacity(0.92)
	static let rowDescription = Color.white.opacity(0.42)
	static let controlBorder = Color.white.opacity(0.14)
	static let toggleTint = Color(red: 0.20, green: 0.78, blue: 0.35)
	static let sidebarSelection = Color.white.opacity(0.10)

	static let cardCornerRadius: CGFloat = 10
	static let controlCornerRadius: CGFloat = 7
	static let contentMaxWidth: CGFloat = 640
	static let rowVerticalPadding: CGFloat = 14
	static let rowHorizontalPadding: CGFloat = 16
}

struct SettingsSectionHeader: View {
	let title: String

	var body: some View {
		Text(title)
			.font(.subheadline.weight(.medium))
			.foregroundStyle(SettingsDesign.sectionHeader)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.leading, 4)
			.padding(.bottom, 6)
	}
}

struct SettingsCard<Content: View>: View {
	@ViewBuilder let content: Content

	var body: some View {
		VStack(spacing: 0) {
			content
		}
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}

struct SettingsRow<Control: View>: View {
	let title: String
	var description: String?
	var showsDivider: Bool = true
	@ViewBuilder let control: Control

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .center, spacing: 16) {
				VStack(alignment: .leading, spacing: 4) {
					Text(title)
						.font(.body)
						.foregroundStyle(SettingsDesign.rowTitle)
					if let description, !description.isEmpty {
						Text(description)
							.font(.subheadline)
							.foregroundStyle(SettingsDesign.rowDescription)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)

				control
					.layoutPriority(1)
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)

			if showsDivider {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
					.padding(.leading, SettingsDesign.rowHorizontalPadding)
			}
		}
	}
}

struct SettingsDropdownLabel: View {
	let title: String

	var body: some View {
		HStack(spacing: 8) {
			Text(title)
				.font(.body)
				.foregroundStyle(SettingsDesign.rowTitle)
				.lineLimit(1)
			Image(systemName: "chevron.up.chevron.down")
				.font(.caption2.weight(.semibold))
				.foregroundStyle(SettingsDesign.rowDescription)
		}
		.padding(.horizontal, 12)
		.padding(.vertical, 7)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.stroke(SettingsDesign.controlBorder, lineWidth: 1)
		}
	}
}

struct SettingsActionButton: View {
	let title: String
	var showsExternalIcon = false
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 6) {
				Text(title)
					.font(.body)
				if showsExternalIcon {
					Image(systemName: "arrow.up.right.square")
						.font(.caption)
				}
			}
			.foregroundStyle(SettingsDesign.rowTitle)
			.padding(.horizontal, 12)
			.padding(.vertical, 7)
			.background(
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.fill(SettingsDesign.cardBackground)
			)
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.stroke(SettingsDesign.controlBorder, lineWidth: 1)
			}
		}
		.buttonStyle(.plain)
	}
}

struct SettingsToggle: View {
	@Binding var isOn: Bool

	var body: some View {
		Toggle("", isOn: $isOn)
			.labelsHidden()
			.toggleStyle(.switch)
			.tint(SettingsDesign.toggleTint)
	}
}

struct SettingsDestructiveButton: View {
	let title: String
	let action: () -> Void

	var body: some View {
		Button(title, role: .destructive, action: action)
			.buttonStyle(.plain)
			.font(.body)
			.foregroundStyle(.red.opacity(0.85))
			.padding(.horizontal, 12)
			.padding(.vertical, 7)
			.background(
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.fill(Color.red.opacity(0.08))
			)
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.stroke(Color.red.opacity(0.22), lineWidth: 1)
			}
	}
}

struct SettingsInlineField: View {
	@Binding var text: String
	var isSecure = false
	var placeholder = ""

	var body: some View {
		Group {
			if isSecure {
				SecureField(placeholder, text: $text)
			} else {
				TextField(placeholder, text: $text)
			}
		}
		.textFieldStyle(.plain)
		.font(.body)
		.foregroundStyle(SettingsDesign.rowTitle)
		.multilineTextAlignment(.trailing)
		.frame(minWidth: 140, maxWidth: 220)
		.padding(.horizontal, 12)
		.padding(.vertical, 7)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.stroke(SettingsDesign.controlBorder, lineWidth: 1)
		}
	}
}
