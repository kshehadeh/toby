import XCTest
@testable import TobyPluginJiraLib

final class JiraClientTests: XCTestCase {
	func testBuildHostUsesSubdomain() {
		XCTAssertEqual(JiraClient.buildHost(domain: "acme"), "https://acme.atlassian.net")
	}

	func testBuildHostAcceptsFullDomain() {
		XCTAssertEqual(
			JiraClient.buildHost(domain: "acme.atlassian.net"),
			"https://acme.atlassian.net"
		)
	}

	func testBuildHostStripsScheme() {
		XCTAssertEqual(
			JiraClient.buildHost(domain: "https://acme.atlassian.net"),
			"https://acme.atlassian.net"
		)
	}

	func testHasCredentialsRequiresAllFields() {
		XCTAssertFalse(JiraClient.hasCredentials(config: [:]))
		XCTAssertFalse(JiraClient.hasCredentials(config: ["domain": "acme", "email": "a@b.com"]))
		XCTAssertTrue(
			JiraClient.hasCredentials(config: [
				"domain": "acme",
				"email": "a@b.com",
				"apiToken": "token",
			])
		)
	}
}
