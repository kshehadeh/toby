import Foundation
import Observation

@Observable @MainActor
final class NewsSetupStore {
	enum Step: Int, CaseIterable {
		case welcome, sources, guardian, ready

		var label: String {
			["Welcome", "Sources", "Guardian", "Ready"][rawValue]
		}

		var title: String {
			[
				"Set up news",
				"Choose your sources",
				"Add a Guardian key",
				"News is connected",
			][rawValue]
		}

		var explanation: String {
			[
				"Toby can fetch headlines from Hacker News and, optionally, The Guardian. Hacker News needs no account.",
				"Hacker News is ready now. Add The Guardian when you want world, science, and culture coverage.",
				"A free Guardian Open Platform key is optional unless you chose The Guardian only. Toby stores it with your other credentials on this Mac.",
				"Toby can fetch headlines and search recent articles from chat and Home.",
			][rawValue]
		}
	}

	enum Source: String, CaseIterable, Identifiable {
		case all
		case hackerNews = "hacker-news"
		case guardian

		var id: String { rawValue }

		var label: String {
			switch self {
			case .all: "Hacker News and The Guardian"
			case .hackerNews: "Hacker News only"
			case .guardian: "The Guardian only"
			}
		}
	}

	struct SectionOption: Identifiable {
		let id: String
		let label: String
	}

	static let sections: [SectionOption] = [
		.init(id: "all", label: "All sections"),
		.init(id: "world", label: "World"),
		.init(id: "us-news", label: "US news"),
		.init(id: "uk-news", label: "UK news"),
		.init(id: "australia-news", label: "Australia news"),
		.init(id: "technology", label: "Technology"),
		.init(id: "business", label: "Business"),
		.init(id: "sport", label: "Sport"),
		.init(id: "science", label: "Science"),
		.init(id: "environment", label: "Environment"),
		.init(id: "culture", label: "Culture"),
		.init(id: "politics", label: "Politics"),
		.init(id: "lifeandstyle", label: "Life and style"),
	]

	static let guardianKeyURL = "https://open-platform.theguardian.com/access/"

	var step: Step = .welcome
	var source: Source = .all
	var defaultSection = "all"
	var apiKey = ""
	var isSubmitting = false
	var error: String?

	private let defaults: UserDefaults
	private let client: TobyClient
	private let stepKey = "newsSetup.step"
	private let sourceKey = "newsSetup.source"
	private let sectionKey = "newsSetup.section"

	var isBusy: Bool { isSubmitting }
	var navigationLocked: Bool { isBusy }
	var includesGuardian: Bool { source != .hackerNews }
	var requiresGuardianKey: Bool { source == .guardian }

	var canConnect: Bool {
		guard !navigationLocked else { return false }
		if requiresGuardianKey {
			return !trimmed(apiKey).isEmpty
		}
		return true
	}

	init(
		initialSource: String? = nil,
		initialSection: String? = nil,
		client: TobyClient = TobyClient(),
		defaults: UserDefaults = .standard
	) {
		self.client = client
		self.defaults = defaults
		if let saved = Step(rawValue: defaults.integer(forKey: stepKey)),
			defaults.object(forKey: stepKey) != nil,
			saved != .ready
		{
			step = saved
		}
		if let savedSource = defaults.string(forKey: sourceKey),
			let parsed = Source(rawValue: savedSource)
		{
			source = parsed
		} else if let initialSource, let parsed = Source(rawValue: initialSource) {
			source = parsed
		}
		if let savedSection = defaults.string(forKey: sectionKey),
			Self.sections.contains(where: { $0.id == savedSection })
		{
			defaultSection = savedSection
		} else if let initialSection, Self.sections.contains(where: { $0.id == initialSection }) {
			defaultSection = initialSection
		}
	}

	func go(to next: Step) {
		guard !navigationLocked else { return }
		step = next
		error = nil
		persistProgress()
	}

	func connect() async -> Bool {
		guard canConnect else { return false }
		isSubmitting = true
		error = nil
		defer { isSubmitting = false }
		var changes: [String: String] = [
			"news.defaultSource": source.rawValue,
			"news.defaultSection": includesGuardian ? defaultSection : "all",
		]
		let key = trimmed(apiKey)
		if !key.isEmpty {
			changes["news.apiKey"] = key
		}
		do {
			_ = try await client.patchConfigure(changes: changes)
			let response = try await client.runIntegrationAction(name: "news", action: .connect)
			guard response.ok else {
				error = response.error ?? "Toby couldn’t connect to News."
				return false
			}
			apiKey = ""
			step = .ready
			defaults.removeObject(forKey: stepKey)
			defaults.removeObject(forKey: sourceKey)
			defaults.removeObject(forKey: sectionKey)
			NotificationCenter.default.post(
				name: .dashboardBlockShouldRefresh,
				object: DashboardBlockID.news.rawValue
			)
			return true
		} catch {
			self.error = error.localizedDescription
			return false
		}
	}

	private func persistProgress() {
		defaults.set(step == .ready ? 0 : step.rawValue, forKey: stepKey)
		defaults.set(source.rawValue, forKey: sourceKey)
		defaults.set(defaultSection, forKey: sectionKey)
	}

	private func trimmed(_ value: String) -> String {
		value.trimmingCharacters(in: .whitespacesAndNewlines)
	}
}
