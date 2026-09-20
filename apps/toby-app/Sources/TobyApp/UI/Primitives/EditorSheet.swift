import SwiftUI

struct EditorSheetSize {
	var minWidth: CGFloat
	var idealWidth: CGFloat
	var minHeight: CGFloat
	var idealHeight: CGFloat

	static let compact = EditorSheetSize(
		minWidth: 420,
		idealWidth: 460,
		minHeight: 520,
		idealHeight: 600
	)
	static let regular = EditorSheetSize(
		minWidth: 520,
		idealWidth: 580,
		minHeight: 560,
		idealHeight: 680
	)
	static let wide = EditorSheetSize(
		minWidth: 640,
		idealWidth: 720,
		minHeight: 620,
		idealHeight: 760
	)
}

/// Shared New/Edit sheet chrome.
///
/// macOS sheets are windows with a title bar. Title and Cancel/Save belong in
/// that system toolbar (`NavigationStack` + `navigationTitle` +
/// `.cancellationAction` / `.confirmationAction`), matching `FlowResultSheet`
/// and `FlowRunDetailView`. Drawing a second headline or footer fights
/// `fullSizeContentView` glass: the in-content title sits under the title bar,
/// and `role: .cancel` / `.defaultAction` buttons get pulled into a clipped
/// bottom chrome strip.
struct EditorSheet<Content: View>: View {
	let title: String
	var isSaving: Bool = false
	var canSave: Bool = true
	var isDirty: Bool = false
	var errorMessage: String? = nil
	var size: EditorSheetSize = .compact
	var accessibilityIdentifier: String = "editor-sheet"
	var cancelAccessibilityIdentifier: String = "editor-sheet-cancel"
	var saveAccessibilityIdentifier: String = "editor-sheet-save"
	let onCancel: () -> Void
	let onSave: () -> Void
	@ViewBuilder var content: () -> Content

	@State private var isDiscardAlertPresented = false

	var body: some View {
		NavigationStack {
			content()
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.safeAreaInset(edge: .top, spacing: 0) {
					if let errorMessage, !errorMessage.isEmpty {
						InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
							.padding(.horizontal, 20)
							.padding(.top, 8)
							.padding(.bottom, 4)
					}
				}
				.navigationTitle(title)
				.toolbarTitleDisplayMode(.inline)
				.toolbar {
					ToolbarItem(placement: .cancellationAction) {
						Button("Cancel") {
							requestCancel()
						}
						.disabled(isSaving)
						.keyboardShortcut(.cancelAction)
						.accessibilityIdentifier(cancelAccessibilityIdentifier)
					}
					ToolbarItem(placement: .confirmationAction) {
						Button("Save") {
							onSave()
						}
						.disabled(isSaving || !canSave)
						.keyboardShortcut(.defaultAction)
						.accessibilityIdentifier(saveAccessibilityIdentifier)
						.accessibilityLabel(isSaving ? "Saving" : "Save")
					}
				}
		}
		.frame(
			minWidth: size.minWidth,
			idealWidth: size.idealWidth,
			minHeight: size.minHeight,
			idealHeight: size.idealHeight
		)
		.interactiveDismissDisabled(isDirty || isSaving)
		.alert("Discard Unsaved Changes?", isPresented: $isDiscardAlertPresented) {
			Button("Keep Editing", role: .cancel) {}
			Button("Discard", role: .destructive) {
				onCancel()
			}
		} message: {
			Text("Your changes will be lost.")
		}
		.accessibilityIdentifier(accessibilityIdentifier)
	}

	private func requestCancel() {
		if isDirty {
			isDiscardAlertPresented = true
		} else {
			onCancel()
		}
	}
}

/// Binding to an optional editor draft that never resurrects a cleared editor.
/// Field controls can still read a fallback while the sheet tears down; `set`
/// is ignored once the source is `nil` so dismiss/Escape cannot reopen a blank sheet.
@MainActor
func editorDraftBinding<Draft: Sendable>(
	_ editor: Binding<Draft?>,
	fallback: @escaping @autoclosure @Sendable () -> Draft
) -> Binding<Draft> {
	Binding(
		get: { editor.wrappedValue ?? fallback() },
		set: { newValue in
			guard editor.wrappedValue != nil else { return }
			editor.wrappedValue = newValue
		}
	)
}

@MainActor
func editorDraftFieldBinding<Draft: Sendable, Value>(
	_ editor: Binding<Draft?>,
	_ keyPath: WritableKeyPath<Draft, Value>,
	fallback: @escaping @autoclosure @Sendable () -> Draft
) -> Binding<Value> {
	// `WritableKeyPath` is a class and is not Sendable; these bindings only
	// run on the main actor from editor sheets.
	nonisolated(unsafe) let keyPath = keyPath
	return Binding(
		get: { (editor.wrappedValue ?? fallback())[keyPath: keyPath] },
		set: { newValue in
			guard editor.wrappedValue != nil else { return }
			editor.wrappedValue?[keyPath: keyPath] = newValue
		}
	)
}

/// Presents an editor sheet from an optional draft. Dismiss (including Escape)
/// clears through `onDismiss` instead of writing a fallback draft back.
@MainActor
func editorSheetItem<Draft: Identifiable & Sendable>(
	_ editor: Binding<Draft?>,
	onDismiss: @escaping () -> Void
) -> Binding<Draft?> {
	nonisolated(unsafe) let onDismiss = onDismiss
	return Binding(
		get: { editor.wrappedValue },
		set: { newValue in
			if newValue == nil {
				onDismiss()
			} else if editor.wrappedValue != nil {
				editor.wrappedValue = newValue
			}
		}
	)
}
