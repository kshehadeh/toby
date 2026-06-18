import SwiftUI

struct IssueReportView: View {
	@Bindable var store: ChatStore
	let onDismiss: () -> Void

	@State private var type = "bug"
	@State private var details = ""
	@FocusState private var focusedField: Field?

	private enum Field {
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

			IssueTypeToggle(selection: $type)
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

				TextEditor(text: $details)
					.font(.body)
					.foregroundStyle(AppTheme.primaryText)
					.padding(12)
					.frame(minWidth: 320, minHeight: 160)
					.scrollContentBackground(.hidden)
					.background(Color.clear)
					.focused($focusedField, equals: .details)
			}
			.frame(minWidth: 320, minHeight: 160)
			.onChange(of: details) { _, newValue in
				if newValue.count > maxLength {
					details = String(newValue.prefix(maxLength))
				}
			}

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
				.keyboardShortcut(.defaultAction)
				.disabled(details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
			}
		}
		.padding(32)
		.frame(minWidth: 440, maxWidth: 440, minHeight: 400)
		.onAppear {
			focusedField = .type
		}
	}

	private func submit() {
		let trimmed = details.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		onDismiss()
		Task { await store.submitIssue(type: type, details: trimmed) }
	}
}

private struct IssueTypeToggle: View {
	@Binding var selection: String

	private let options = [
		("bug", "Bug"),
		("feature", "Feature"),
	]

	var body: some View {
		GeometryReader { geometry in
			let buttonWidth = (geometry.size.width - 4) / 2
			HStack(spacing: 4) {
				ForEach(options, id: \.0) { value, label in
					let isSelected = selection == value
					Button {
						selection = value
					} label: {
						ZStack {
							RoundedRectangle(cornerRadius: 8)
								.fill(isSelected ? AppTheme.accent : Color.clear)
							Text(label)
								.font(.subheadline.weight(.medium))
								.foregroundStyle(isSelected ? Color.black : AppTheme.primaryText)
						}
						.frame(width: buttonWidth, height: geometry.size.height)
						.contentShape(Rectangle())
					}
					.buttonStyle(.plain)
				}
			}
			.padding(4)
			.background(SettingsDesign.cardBackground)
			.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
		}
		.frame(height: 40)
		.frame(maxWidth: .infinity)
	}
}
