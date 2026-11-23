import Foundation

enum OnboardingStepKind: String, Identifiable {
	case configureAIProvider
	case connectIntegrations
	case setupPersona
	case grantPermissions
	case createSchedule
	case createSkill
	case recordAndTranscribe
	case samplePrompt

	var id: String { rawValue }
}

struct OnboardingStep: Identifiable, Equatable {
	let kind: OnboardingStepKind
	let title: String
	let subtitle: String
	let systemImage: String
	let isComplete: Bool
	/// Action button label shown for incomplete steps (nil hides the button).
	let actionLabel: String?

	var id: String { kind.rawValue }
}

struct OnboardingChecklist: Equatable {
	let steps: [OnboardingStep]

	var completedCount: Int { steps.filter(\.isComplete).count }
	var totalCount: Int { steps.count }
	var isComplete: Bool { completedCount == totalCount }
	var progress: Double {
		guard totalCount > 0 else { return 0 }
		return Double(completedCount) / Double(totalCount)
	}

	/// First incomplete step in checklist order (highlighted as "UP NEXT").
	var upNextKind: OnboardingStepKind? {
		steps.first(where: { !$0.isComplete })?.kind
	}

	static func make(
		hasConfiguredAIProvider: Bool,
		hasConnectedIntegrations: Bool,
		hasModelConfigured: Bool,
		hasRequiredPermissions: Bool,
		hasSchedule: Bool,
		hasSkill: Bool,
		hasRecording: Bool,
		hasSession: Bool
	) -> OnboardingChecklist {
		return OnboardingChecklist(steps: [
			OnboardingStep(
				kind: .configureAIProvider,
				title: "Sign in with OpenRouter",
				subtitle: "One account for every AI model Toby uses",
				systemImage: "cpu",
				isComplete: hasConfiguredAIProvider,
				actionLabel: "Connect"
			),
			OnboardingStep(
				kind: .connectIntegrations,
				title: "Connect your apps",
				subtitle: "Mail, Slack, and Calendar",
				systemImage: "puzzlepiece.extension",
				isComplete: hasConnectedIntegrations,
				actionLabel: "Connect"
			),
			OnboardingStep(
				kind: .setupPersona,
				title: "Set up persona & model",
				subtitle: "Choose how Toby sounds and thinks",
				systemImage: "person.crop.circle",
				isComplete: hasModelConfigured,
				actionLabel: "Set up"
			),
			OnboardingStep(
				kind: .grantPermissions,
				title: "Grant permissions (mic, screen)",
				subtitle: "Allow audio & screen access",
				systemImage: "mic",
				isComplete: hasRequiredPermissions,
				actionLabel: "Grant"
			),
			OnboardingStep(
				kind: .createSchedule,
				title: "Create your first scheduled flow",
				subtitle: "Automate a recurring task",
				systemImage: DetailRoute.flows.systemImage,
				isComplete: hasSchedule,
				actionLabel: "Create"
			),
			OnboardingStep(
				kind: .createSkill,
				title: "Create a skill",
				subtitle: "Teach Toby a reusable capability",
				systemImage: DetailRoute.skills.systemImage,
				isComplete: hasSkill,
				actionLabel: "Create"
			),
			OnboardingStep(
				kind: .recordAndTranscribe,
				title: "Record and transcribe",
				subtitle: "Capture your first recording",
				systemImage: DetailRoute.recordings.systemImage,
				isComplete: hasRecording,
				actionLabel: "Record"
			),
			OnboardingStep(
				kind: .samplePrompt,
				title: "Try a sample prompt",
				subtitle: "See Toby handle a real request",
				systemImage: DetailRoute.chat.systemImage,
				isComplete: hasSession,
				actionLabel: "Try it"
			),
		])
	}
}
