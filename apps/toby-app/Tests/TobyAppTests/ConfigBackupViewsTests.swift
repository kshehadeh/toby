import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ConfigBackupViews")
struct ConfigBackupViewsTests {
	@Test("backup sheet shows title and choose location action")
	func backupSheetStructure() throws {
		let view = ConfigBackupSheet(
			onDismiss: {},
			onSuccess: { _ in },
			onError: { _ in }
		)
		let title = try view.inspect().find(text: "Backup Toby Data")
		#expect(try title.string() == "Backup Toby Data")
		_ = try view.inspect().find(button: "Choose Location…")
		_ = try view.inspect().find(button: "Cancel")
	}

	@Test("backup sheet copy covers project files and recordings")
	func backupSheetCopyMentionsFileScopes() throws {
		let view = ConfigBackupSheet(
			onDismiss: {},
			onSuccess: { _ in },
			onError: { _ in }
		)
		let copy = try view.inspect().findAll(ViewType.Text.self)
			.compactMap { try? $0.string() }
			.joined(separator: " ")
		#expect(copy.contains("project files"))
		#expect(copy.contains("recordings"))
	}

	@Test("restore sheet shows destructive restore action")
	func restoreSheetStructure() throws {
		let url = URL(fileURLWithPath: "/tmp/example.tbybak")
		let view = ConfigRestoreSheet(
			backupURL: url,
			onDismiss: {},
			onSuccess: {},
			onError: { _ in }
		)
		let title = try view.inspect().find(text: "Restore Toby Data")
		#expect(try title.string() == "Restore Toby Data")
		_ = try view.inspect().find(button: "Restore")
		_ = try view.inspect().find(button: "Cancel")
	}

	@Test("restore sheet copy covers project files and recordings")
	func restoreSheetCopyMentionsFileScopes() throws {
		let url = URL(fileURLWithPath: "/tmp/example.tbybak")
		let view = ConfigRestoreSheet(
			backupURL: url,
			onDismiss: {},
			onSuccess: {},
			onError: { _ in }
		)
		let copy = try view.inspect().findAll(ViewType.Text.self)
			.compactMap { try? $0.string() }
			.joined(separator: " ")
		#expect(copy.contains("project files"))
		#expect(copy.contains("recordings"))
	}
}
