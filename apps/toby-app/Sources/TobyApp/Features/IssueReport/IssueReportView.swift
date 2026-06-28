import SwiftUI
import AppKit

struct IssueReportView: View {
	@Bindable var store: ChatStore
	let onDismiss: () -> Void

	@State private var type = "bug"
	@State private var details = ""
	@FocusState private var focusedField: Field?

	private enum Field: Hashable {
		case type
		case details
	}

	private let maxLength = 2000

	var body: some View {
		VStack(alignment: .leading, spacing: 24) {
			Text("Report app issue")
				.font(.title2)
				.fontWeight(.bold)
				.foregroundStyle(AppTheme.primaryText)
				.padding(.top, 8)

			Picker(selection: $type) {
				Text("Bug").tag("bug")
				Text("Feature").tag("feature")
			} label: {
				EmptyView()
			}
			.pickerStyle(.segmented)
			.accessibilityLabel("Issue type")
			.focused($focusedField, equals: .type)

			Text("What happened?")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			ZStack(alignment: .topLeading) {
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(AppTheme.elevatedBackground)

				if details.isEmpty {
					Text("Tell us about the issue you encountered")
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(16)
						.allowsHitTesting(false)
				}

				IssueReportTextEditor(
					text: $details,
					maxLength: maxLength,
					onSubmit: submit
				)
				.padding(12)
				.frame(minWidth: 320, minHeight: 160)
				.focused($focusedField, equals: .details)
			}
			.frame(minWidth: 320, minHeight: 160)

			HStack {
				Spacer()
				Text("\(details.count) / \(maxLength)")
					.font(.caption)
					.foregroundStyle(AppTheme.secondaryText)
			}

			Text("Any information you share may be reviewed to help improve Toby.")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)

			HStack {
				Spacer()
				Button("Cancel", role: .cancel) {
					onDismiss()
				}
				Button("Submit") {
					submit()
				}
				.keyboardShortcut(.return, modifiers: [.command])
				.disabled(details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
			}
		}
		.padding(32)
		.frame(minWidth: 440, maxWidth: 440, minHeight: 400)
		.defaultFocus($focusedField, .type)
	}

	private func submit() {
		let trimmed = details.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		onDismiss()
		Task { await store.submitIssue(type: type, details: trimmed) }
	}
}


