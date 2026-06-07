import XCTest
@testable import TobyPluginAppleMailLib

final class AppleMailParserTests: XCTestCase {
	func testEscapeForAppleScript() {
		XCTAssertEqual(
			AppleScriptRunner.escapeForAppleScript("say \"hi\" \\ path"),
			"say \\\"hi\\\" \\\\ path"
		)
		XCTAssertEqual(AppleScriptRunner.escapeForAppleScript(""), "")
	}

	func testParseAppleScriptDateNumeric() {
		let date = AppleScriptRunner.parseAppleScriptDate("2026-5-2-14-30-0")
		var calendar = Calendar.current
		calendar.timeZone = TimeZone.current
		XCTAssertEqual(calendar.component(.year, from: date), 2026)
		XCTAssertEqual(calendar.component(.month, from: date), 5)
		XCTAssertEqual(calendar.component(.day, from: date), 2)
	}

	func testParseAppleMailAccountListOutput() {
		let raw = "Work<<<EM>>>a@b.com<<<ACCITEM>>>Personal<<<EM>>>"
		let rows = MailClient.parseAppleMailAccountListOutput(raw)
		XCTAssertEqual(rows.count, 2)
		XCTAssertEqual(rows[0].name, "Work")
		XCTAssertEqual(rows[0].email, "a@b.com")
		XCTAssertEqual(rows[1].name, "Personal")
		XCTAssertNil(rows[1].email)
	}

	func testParseMailboxListOutput() {
		let raw =
			"Work<<<MBCOL>>>INBOX<<<MBROW>>>Work<<<MBCOL>>>Sent Messages<<<MBROW>>>Personal<<<MBCOL>>>Notes"
		let rows = MailClient.parseMailboxListOutput(raw)
		XCTAssertEqual(rows.count, 3)
		XCTAssertEqual(rows[0].account, "Work")
		XCTAssertEqual(rows[0].name, "INBOX")
		XCTAssertEqual(rows[2].account, "Personal")
		XCTAssertEqual(rows[2].name, "Notes")
	}
}
