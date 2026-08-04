import AppKit
import SwiftUI

/// Standalone persona editor window. Delegates the form to
/// `PersonaEditorFormView` and adds window-level chrome (fixed size,
/// non-resizable mask).
struct PersonaEditorView: View {
	@Bindable var store: PersonaEditorStore
	let onSaved: () -> Void
	let onCancel: () -> Void

	@Environment(\.dismissWindow) private var dismissWindow

	var body: some View {
		PersonaEditorFormView(
			store: store,
			onSaved: {
				onSaved()
				dismissWindow()
			},
			onCancel: {
				onCancel()
				dismissWindow()
			},
			onReset: {}
		)
		.frame(minWidth: 520, minHeight: 520)
		.background(WindowAccessor { window in
			window.styleMask.remove([.miniaturizable, .resizable])
		})
	}
}

extension PersonaEditorStore.Mode {
	var isCreate: Bool {
		if case .create = self { return true }
		return false
	}

	var isEdit: Bool {
		if case .edit = self { return true }
		return false
	}
}
