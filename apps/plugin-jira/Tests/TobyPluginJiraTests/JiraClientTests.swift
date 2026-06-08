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

	func testBuildGatewayHost() {
		XCTAssertEqual(
			JiraClient.buildGatewayHost(cloudId: "01471ff9-bd52-4ad0-81cc-c26e7353b36b"),
			"https://api.atlassian.com/ex/jira/01471ff9-bd52-4ad0-81cc-c26e7353b36b"
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
