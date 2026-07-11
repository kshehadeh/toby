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
		let title = try view.inspect().find(text: "Backup Settings")
		#expect(try title.string() == "Backup Settings")
		_ = try view.inspect().find(button: "Choose Location…")
		_ = try view.inspect().find(button: "Cancel")
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
		let title = try view.inspect().find(text: "Restore Settings")
		#expect(try title.string() == "Restore Settings")
		_ = try view.inspect().find(button: "Restore")
		_ = try view.inspect().find(button: "Cancel")
	}
}
