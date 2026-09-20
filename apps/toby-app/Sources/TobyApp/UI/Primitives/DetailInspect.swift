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

/// Shared column layout for inspect-only label/value rows.
/// Labels size to the longest label in the stack; values sit immediately beside them.
struct DetailMetadataStack<Content: View>: View {
	@ViewBuilder var content: () -> Content

	var body: some View {
		Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 6) {
			content()
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

/// One label/value pair for inspect-only details. This is a `GridRow`-returning
/// function (not a `View` wrapper) so sibling rows in `DetailMetadataStack` share
/// a label column.
@ViewBuilder
func DetailMetadataRow(label: String, value: String, monospaced: Bool = false) -> some View {
	GridRow {
		Text(label)
			.font(.system(size: 12))
			.foregroundStyle(SettingsDesign.rowDescription)
			.gridColumnAlignment(.leading)

		Text(value)
			.font(monospaced ? .system(size: 12, design: .monospaced) : .system(size: 12))
			.foregroundStyle(SettingsDesign.rowTitle)
			.multilineTextAlignment(.leading)
			.lineLimit(3)
			.textSelection(.enabled)
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
