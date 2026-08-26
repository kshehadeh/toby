import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("DashboardSidebarView")
struct DashboardSidebarViewTests {
	@Test("empty projects omit the recent projects section")
	func emptyProjectsOmitSection() throws {
		let view = makeView(projects: [])
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Recent Chats")
		}
		#expect(throws: Error.self) {
			try view.inspect().find(text: "Recent Projects")
		}
		#expect(throws: Error.self) {
			try view.inspect().find(text: "Recent Schedule Runs")
		}
	}

	@Test("recent projects lists names and opens on tap")
	func recentProjectsListAndOpen() throws {
		var opened: String?
		let view = makeView(
			projects: [
				sampleProject(id: "p1", name: "Website", updatedAt: "2026-08-20T10:00:00Z"),
				sampleProject(id: "p2", name: "Newsletter", updatedAt: "2026-08-21T10:00:00Z"),
			],
			onOpenProject: { opened = $0 }
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Recent Projects")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Website")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Newsletter")
		}
		try view.inspect()
			.find(viewWithAccessibilityIdentifier: "dashboard-sidebar-project-p2")
			.button()
			.tap()
		#expect(opened == "p2")
	}

	@Test("recent projects keeps the five most recently updated")
	func recentProjectsKeepsFiveMostRecent() throws {
		let projects = (1...6).map { index in
			sampleProject(
				id: "p\(index)",
				name: "Project \(index)",
				updatedAt: "2026-08-0\(index)T10:00:00Z"
			)
		}
		let view = makeView(projects: projects)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Project 6")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Project 2")
		}
		#expect(throws: Error.self) {
			try view.inspect().find(text: "Project 1")
		}
		#expect(throws: Error.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-sidebar-project-p1")
		}
	}

	private func makeView(
		projects: [ProjectSummary],
		onOpenProject: @escaping (String) -> Void = { _ in }
	) -> DashboardSidebarView {
		DashboardSidebarView(
			sessions: [],
			projects: projects,
			recordings: [],
			memories: [],
			isSessionsLoading: false,
			onOpenSession: { _ in },
			onOpenProject: onOpenProject,
			onOpenRecording: { _ in },
			onOpenMemory: { _ in }
		)
	}

	private func sampleProject(
		id: String,
		name: String,
		updatedAt: String? = nil
	) -> ProjectSummary {
		ProjectSummary(
			id: id,
			slug: id,
			name: name,
			summary: "",
			folderPath: "/tmp/\(id)",
			personaName: nil,
			outputsDir: nil,
			skillsDir: nil,
			createdAt: updatedAt,
			updatedAt: updatedAt
		)
	}
}
