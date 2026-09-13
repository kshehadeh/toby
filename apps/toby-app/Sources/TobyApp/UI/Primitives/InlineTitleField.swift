import SwiftUI

/// Always-visible editable title for a detail header. Edits are held in a
/// local draft: Return accepts and blurs, Escape reverts to the last accepted
/// name, and losing focus accepts.
struct InlineTitleField: View {
	@Binding var name: String
	var placeholder: String
	var accessibilityIdentifier: String

	@State private var draft: String
	@FocusState private var isFocused: Bool

	init(
		name: Binding<String>,
		placeholder: String,
		accessibilityIdentifier: String,
	) {
		_name = name
		self.placeholder = placeholder
		self.accessibilityIdentifier = accessibilityIdentifier
		_draft = State(initialValue: name.wrappedValue)
	}

	var body: some View {
		TextField(placeholder, text: $draft)
			.textFieldStyle(.plain)
			.font(.system(size: 22, weight: .semibold))
			.foregroundStyle(SettingsDesign.rowTitle)
			.lineLimit(1)
			.focused($isFocused)
			.onSubmit(commit)
			.onExitCommand(perform: revert)
			.onChange(of: isFocused) { _, focused in
				guard !focused else { return }
				commit()
			}
			.onChange(of: name) { _, accepted in
				guard !isFocused else { return }
				draft = accepted
			}
			.accessibilityIdentifier(accessibilityIdentifier)
	}

	private func commit() {
		isFocused = false
		if let accepted = acceptedInlineTitle(draft: draft, current: name) {
			draft = accepted
			name = accepted
		} else {
			draft = name
		}
	}

	private func revert() {
		draft = name
	}
}

/// The name to accept from an in-progress title edit: trimmed, non-empty, and
/// different from the current name — otherwise nil, meaning the draft reverts.
func acceptedInlineTitle(draft: String, current: String) -> String? {
	let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
	guard !trimmed.isEmpty, trimmed != current else { return nil }
	return trimmed
}
