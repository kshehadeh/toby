import Foundation

enum OnboardingStepKind: String, Identifiable {
	case configureAIProvider
	case connectIntegrations
	case setupPersona
	case grantPermissions
	case createSchedule
	case samplePrompt

	var id: String { rawValue }
}

struct OnboardingStep: Identifiable, Equatable {
	let kind: OnboardingStepKind
	let title: String
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

	static func make(
		hasConfiguredAIProvider: Bool,
		hasConnectedIntegrations: Bool,
		hasModelConfigured: Bool,
		hasRequiredPermissions: Bool,
		hasSchedule: Bool,
		hasSession: Bool
	) -> OnboardingChecklist {
		OnboardingChecklist(steps: [
			OnboardingStep(
				kind: .configureAIProvider,
				title: "Configure AI provider",
				isComplete: hasConfiguredAIProvider,
				actionLabel: "Configure"
			),
			OnboardingStep(
				kind: .connectIntegrations,
				title: "Connect integrations",
				isComplete: hasConnectedIntegrations,
				actionLabel: "Connect"
			),
			OnboardingStep(
				kind: .setupPersona,
				title: "Set up persona & model",
				isComplete: hasModelConfigured,
				actionLabel: "Set up"
			),
			OnboardingStep(
				kind: .grantPermissions,
				title: "Grant permissions (mic, screen)",
				isComplete: hasRequiredPermissions,
				actionLabel: "Grant"
			),
			OnboardingStep(
				kind: .createSchedule,
				title: "Create your first schedule",
				isComplete: hasSchedule,
				actionLabel: "Create"
			),
			OnboardingStep(
				kind: .samplePrompt,
				title: "Try a sample prompt",
				isComplete: hasSession,
				actionLabel: "Try it"
			),
		])
	}
}
