import Foundation
import Observation

/// Stable IDs are persisted; append new lessons without changing existing IDs.
enum TutorialStep: String, CaseIterable, Sendable {
	case home, chats, projects, library, recordings, flows, skills
	case builtInFlow, howItWorks, flowSources, flowAI, flowSharing, createFlow
	case editorTrigger, editorSources, editorAI, editorOutput

	var title: String {
		switch self {
		case .home: "Home"
		case .chats: "Chats"
		case .projects: "Projects"
		case .library: "Library"
		case .recordings: "Recordings"
		case .flows: "Flows"
		case .skills: "Skills"
		case .builtInFlow: "Explore a built-in flow"
		case .howItWorks: "How it works"
		case .flowSources: "Gathers and acts"
		case .flowAI: "Thinks"
		case .editorSources: "Steps"
		case .editorAI: "AI prompts"
		case .flowSharing, .editorOutput: "Shares the output"
		case .createFlow: "Create your own flow"
		case .editorTrigger: "Choose a trigger"
		}
	}

	var message: String {
		switch self {
		case .home: "Home brings together your dashboard cards, recent work, and flow actions. Customize the dashboard with Edit Home. This tutorial introduces the workspaces in the sidebar; each workspace also has its own tutorial button."
		case .chats: "Start a conversation with Toby, attach files, and review earlier chats here. Choose a persona to change how Toby helps, and use the work log to inspect tools and steps."
		case .projects: "Keep related chats, files, and instructions together in a project. Select a project to browse its work, or create one for a new topic."
		case .library: "Add files to your library so Toby can find and use their contents in conversations."
		case .recordings: "Browse audio recordings, read transcripts, and generate summaries here."
		case .flows: "Flows gather information, use AI, and deliver results. They can run manually, on a schedule, or in response to an event."
		case .skills: "Skills give Toby reusable instructions for recurring tasks. Browse existing skills, or create one with instructions you want Toby to follow."
		case .builtInFlow: "Open this built-in flow to see its triggers, steps, and destinations. Exploring its details won’t run it."
		case .howItWorks: "Read this section from top to bottom. It tells the story of what Toby does each time this flow runs."
		case .flowSources: "Gathers and acts uses tools to fetch information or perform actions. Each step can pass its output to later steps."
		case .flowAI: "Thinks uses AI to summarize, transform, or decide from earlier results. Some flows use tools alone and don’t need AI."
		case .flowSharing: "Shares shows where the final answer goes, such as Home, a result window, or email. Destinations vary by flow."
		case .createFlow: "Built-in flows are read-only. Open a new draft to choose your own trigger, sources, AI instructions, and output. The tour won’t save or run it."
		case .editorTrigger: "A trigger decides when the flow starts: manually, from Home, on a schedule, or from a supported event. Configure its options here."
		case .editorSources: "Steps run from top to bottom. Add actions to gather tasks, calendar events, mail, or other tool results, or to do something like show a notification. Later steps can use earlier outputs."
		case .editorAI: "Add an AI prompt anywhere you want Toby to summarize, write, or decide. Choose the data it reads, write instructions, and pick an answer format. Steps below it can use its answer, including another AI prompt."
		case .editorOutput: "This is the output area. Choose where to share the answer: a window, Home, email, or another available destination. With no destination, a manual run shows the result in a window. Finish the tour, then customize and save your draft or cancel it."
		}
	}

	var actionTitle: String {
		switch self {
		case .builtInFlow: "Open flow"
		case .createFlow: "Open new draft"
		case .editorOutput: "Finish tour"
		default: "Next"
		}
	}

	static func sidebarStep(for route: DetailRoute) -> Self? {
		switch route {
		case .projects: .projects
		case .library: .library
		case .recordings: .recordings
		case .flows: .flows
		case .skills: .skills
		default: nil
		}
	}
}

@MainActor
@Observable
final class TutorialStore {
	static let shared = TutorialStore()
	private let defaults: UserDefaults
	private static let visibilityKey = "tutorial.enabled"
	private static let progressKey = "tutorial.sectionProgress"
	private static let generationKey = "tutorial.generation"

	/// This preference controls only the permanent toolbar button.
	var showTutorialButton: Bool {
		didSet { defaults.set(showTutorialButton, forKey: Self.visibilityKey) }
	}
	private(set) var completedBySection: [String: [String]]
	private(set) var activeSection: TutorialSection?
	private(set) var generation: Int

	var currentStep: TutorialStep? {
		guard let activeSection else { return nil }
		let completed = completedBySection[activeSection.rawValue] ?? []
		return activeSection.steps.first { !completed.contains($0.rawValue) }
	}

	var isLastStep: Bool {
		guard let currentStep, let activeSection else { return false }
		return currentStep == activeSection.steps.last
	}

	init(defaults: UserDefaults = .standard) {
		self.defaults = defaults
		showTutorialButton = defaults.object(forKey: Self.visibilityKey) as? Bool ?? true
		completedBySection = defaults.dictionary(forKey: Self.progressKey) as? [String: [String]] ?? [:]
		activeSection = nil
		generation = defaults.integer(forKey: Self.generationKey) + 1
		defaults.set(generation, forKey: Self.generationKey)
	}

	/// The toolbar always replays just the current section from its first lesson.
	func start(_ section: TutorialSection) {
		completedBySection[section.rawValue] = []
		persistProgress()
		generation += 1
		defaults.set(generation, forKey: Self.generationKey)
		activeSection = section
	}

	func advance(_ step: TutorialStep) {
		guard currentStep == step, let section = activeSection else { return }
		completedBySection[section.rawValue, default: []].append(step.rawValue)
		persistProgress()
		if currentStep == nil { activeSection = nil }
	}

	/// Ignore callbacks from a popover replaced by advancement or replay.
	func stop(ifCurrent step: TutorialStep, generation: Int) {
		guard currentStep == step, self.generation == generation else { return }
		activeSection = nil
	}

	func setContext(_ section: TutorialSection) {
		if let activeSection, activeSection != section { self.activeSection = nil }
	}

	private func persistProgress() {
		defaults.set(completedBySection, forKey: Self.progressKey)
	}
}
