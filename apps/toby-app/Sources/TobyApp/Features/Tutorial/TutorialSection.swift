import Foundation

/// Each section owns its ordered lessons and independent saved progress.
enum TutorialSection: String, CaseIterable, Sendable {
	case home, chats, projects, library, recordings, flows, skills

	var title: String {
		switch self {
		case .home: "Home"
		case .chats: "Chats"
		case .projects: "Projects"
		case .library: "Library"
		case .recordings: "Recordings"
		case .flows: "Flows"
		case .skills: "Skills"
		}
	}

	var steps: [TutorialStep] {
		switch self {
		case .home: [.home, .projects, .library, .recordings, .flows, .skills]
		case .chats: [.chats]
		case .projects: [.projects]
		case .library: [.library]
		case .recordings: [.recordings]
		case .flows: [.flows, .builtInFlow, .howItWorks, .flowSources, .flowAI, .flowSharing, .createFlow,
			.editorTrigger, .editorSources, .editorAI, .editorOutput]
		case .skills: [.skills]
		}
	}

	static func forRoute(_ route: DetailRoute) -> Self {
		switch route {
		case .dashboard: .home
		case .chat: .chats
		case .projects: .projects
		case .library: .library
		case .recordings: .recordings
		case .flows: .flows
		case .skills: .skills
		}
	}
}
