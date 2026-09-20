import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("EditorSheet")
struct EditorSheetTests {
	@Test("renders navigation chrome, cancel, save, and content")
	func rendersChrome() throws {
		let view = EditorSheet(
			title: "Edit Thing",
			isSaving: false,
			canSave: true,
			isDirty: false,
			onCancel: {},
			onSave: {}
		) {
			Text("Sheet body")
		}
		#expect(throws: Never.self) {
			try view.inspect().navigationStack()
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Sheet body")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "editor-sheet")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "editor-sheet-cancel")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "editor-sheet-save")
		}
	}

	@Test("save is disabled when canSave is false")
	func saveDisabledWhenInvalid() throws {
		let view = EditorSheet(
			title: "New Thing",
			canSave: false,
			onCancel: {},
			onSave: {}
		) {
			EmptyView()
		}
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "editor-sheet-save"
		).button()
		#expect(button.isDisabled())
	}

	@Test("clean cancel calls onCancel")
	func cleanCancelCallsOnCancel() throws {
		var cancelled = false
		let view = EditorSheet(
			title: "Edit Thing",
			isDirty: false,
			onCancel: { cancelled = true },
			onSave: {}
		) {
			EmptyView()
		}
		try view.inspect().find(viewWithAccessibilityIdentifier: "editor-sheet-cancel").button().tap()
		#expect(cancelled)
	}

	@Test("dirty cancel presents discard alert instead of dismissing")
	func dirtyCancelPresentsDiscardAlert() throws {
		var cancelled = false
		let view = EditorSheet(
			title: "Edit Thing",
			isDirty: true,
			onCancel: { cancelled = true },
			onSave: {}
		) {
			EmptyView()
		}
		try view.inspect().find(viewWithAccessibilityIdentifier: "editor-sheet-cancel").button().tap()
		#expect(!cancelled)
	}

	@Test("shows inline error message")
	func showsError() throws {
		let view = EditorSheet(
			title: "Edit Thing",
			errorMessage: "Could not save",
			onCancel: {},
			onSave: {}
		) {
			EmptyView()
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Could not save")
		}
	}

	@Test("draft binding does not resurrect a cleared editor")
	func draftBindingDoesNotResurrectClearedEditor() {
		var editor: ProjectEditorDraft? = .blank()
		let source = Binding(
			get: { editor },
			set: { editor = $0 }
		)
		let draft = editorDraftBinding(source, fallback: .blank())
		editor = nil
		var blank = ProjectEditorDraft.blank()
		blank.name = ""
		draft.wrappedValue = blank
		#expect(editor == nil)
	}

	@Test("sheet item dismiss does not write a fallback draft")
	func sheetItemDismissDoesNotWriteFallback() {
		var editor: ProjectEditorDraft? = .blank()
		var dismissed = false
		let item = editorSheetItem(
			Binding(
				get: { editor },
				set: { editor = $0 }
			),
			onDismiss: {
				dismissed = true
				editor = nil
			}
		)
		item.wrappedValue = nil
		#expect(dismissed)
		#expect(editor == nil)
		item.wrappedValue = .blank()
		#expect(editor == nil)
	}
}

@MainActor
@Suite("DetailInspect")
struct DetailInspectTests {
	@Test("heading shows the title")
	func headingRendersTitle() throws {
		let view = DetailHeading(title: "Daily Review", accessibilityIdentifier: "detail-heading")
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Daily Review")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "detail-heading")
		}
	}

	@Test("metadata row shows label and value")
	func metadataRowRenders() throws {
		let view = DetailMetadataStack {
			DetailMetadataRow(label: "Persona", value: "Toby")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Persona")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Toby")
		}
	}

	@Test("metadata stack keeps sibling rows in one grid")
	func metadataStackUsesGrid() throws {
		let view = DetailMetadataStack {
			DetailMetadataRow(label: "Enabled", value: "Offered to the model")
			DetailMetadataRow(label: "Created", value: "Aug 20, 2026 at 4:56 PM")
		}
		let grid = try view.inspect().find(ViewType.Grid.self)
		#expect(try grid.horizontalSpacing() == 16)
		#expect(try grid.verticalSpacing() == 6)
		#expect(try grid.gridRow(0).text(0).string() == "Enabled")
		#expect(try grid.gridRow(0).text(1).string() == "Offered to the model")
		#expect(try grid.gridRow(1).text(0).string() == "Created")
		#expect(try grid.gridRow(1).text(1).string() == "Aug 20, 2026 at 4:56 PM")
	}

	@Test("section shows title and content")
	func sectionRenders() throws {
		let view = DetailSection(title: "Summary") {
			Text("Helps with research")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Summary")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Helps with research")
		}
	}
}
