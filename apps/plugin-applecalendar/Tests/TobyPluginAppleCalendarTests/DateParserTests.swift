import XCTest
@testable import TobyPluginAppleCalendarLib

final class DateParserTests: XCTestCase {
	func testNormalizeNaturalLanguagePassThrough() {
		XCTAssertEqual(DateParser.normalizeToAppleScriptDate("May 12, 2026"), "May 12, 2026")
		XCTAssertEqual(DateParser.normalizeToAppleScriptDate("January 1, 2026"), "January 1, 2026")
	}

	func testNormalizeIsoDateOnly() {
		XCTAssertEqual(DateParser.normalizeToAppleScriptDate("2026-05-12"), "May 12, 2026")
		XCTAssertEqual(DateParser.normalizeToAppleScriptDate("2026-01-01"), "January 1, 2026")
	}

	func testNormalizeIsoDateTime() {
		let result = DateParser.normalizeToAppleScriptDate("2026-05-12T09:00:00")
		XCTAssertTrue(result.contains("May 12, 2026"))
		XCTAssertTrue(result.contains("9:00:00 AM"))
	}

	func testNormalizeSlashDate() {
		XCTAssertEqual(DateParser.normalizeToAppleScriptDate("05/12/2026"), "May 12, 2026")
	}

	func testParseCalendarListOutput() {
		XCTAssertEqual(CalendarClient.parseCalendarListOutput(""), [])
		let single = CalendarClient.parseCalendarListOutput("Home|||CALCOL|||Red")
		XCTAssertEqual(single.count, 1)
		XCTAssertEqual(single[0].name, "Home")
		XCTAssertEqual(single[0].color, "Red")
		let multiple = CalendarClient.parseCalendarListOutput("Home|||CALCOL|||Red|||CALROW|||Work|||CALCOL|||Blue")
		XCTAssertEqual(multiple.count, 2)
		XCTAssertEqual(multiple[0].name, "Home")
		XCTAssertEqual(multiple[1].name, "Work")
	}

	func testIsDateOnlyInput() {
		XCTAssertTrue(DateParser.isDateOnlyInput("2026-05-14"))
		XCTAssertTrue(DateParser.isDateOnlyInput("05/14/2026"))
		XCTAssertTrue(DateParser.isDateOnlyInput("May 14, 2026"))
		XCTAssertFalse(DateParser.isDateOnlyInput("2026-05-14T09:00:00"))
	}
}
