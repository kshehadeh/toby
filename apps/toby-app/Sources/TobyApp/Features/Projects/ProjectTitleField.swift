import SwiftUI

/// Always-visible editable title for the project detail header. Edits are held
/// in a local draft: Return accepts and blurs, Escape reverts to the last
/// accepted name, and losing focus accepts.
struct ProjectTitleField: View {
	@Binding var name: String

	@State private var draft: String
	@FocusState private var isFocused: Bool

	init(name: Binding<String>) {
		_name = name
		_draft = State(initialValue: name.wrappedValue)
	}

	var body: some View {
		TextField("Project name", text: $draft)
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
			.accessibilityIdentifier("project-title-field")
	}

	private func commit() {
		isFocused = false
		if let accepted = acceptedProjectName(draft: draft, current: name) {
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
