import SwiftUI

/// Large readable title for inspect-only entity details.
struct DetailHeading: View {
	let title: String
	var accessibilityIdentifier: String? = nil

	var body: some View {
		Text(title)
			.font(.title2.weight(.semibold))
			.foregroundStyle(SettingsDesign.rowTitle)
			.textSelection(.enabled)
			.frame(maxWidth: .infinity, alignment: .leading)
			.accessibilityAddIdentifiers(accessibilityIdentifier)
	}
}

/// Section title plus content used by inspect-only detail panes.
struct DetailSection<Content: View>: View {
	let title: String
	@ViewBuilder var content: () -> Content

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text(title)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			content()
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}
}

/// Label-left / value-right metadata row for inspect-only details.
struct DetailMetadataRow: View {
	let label: String
	let value: String
	var monospaced: Bool = false

	var body: some View {
		HStack(alignment: .firstTextBaseline) {
			Text(label)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
			Spacer(minLength: 12)
			Text(value)
				.font(monospaced ? .system(size: 12, design: .monospaced) : .system(size: 12))
				.foregroundStyle(SettingsDesign.rowTitle)
				.multilineTextAlignment(.trailing)
				.lineLimit(3)
				.textSelection(.enabled)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

private extension View {
	@ViewBuilder
	func accessibilityAddIdentifiers(_ identifier: String?) -> some View {
		if let identifier {
			accessibilityIdentifier(identifier)
		} else {
			self
		}
	}
}
