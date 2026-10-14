import SwiftUI
import TipKit

struct TutorialTip: Tip {
	let step: TutorialStep
	let generation: Int
	var isLastStep: Bool = false
	var id: String { "tutorial-\(generation)-\(step.rawValue)" }
	var title: Text { Text(step.title) }
	var message: Text? { Text(step.message) }
	var image: Image? { Image(systemName: "map") }
	var actions: [Action] {
		[Action(id: "next", title: isLastStep ? "Finish tutorial" : step.actionTitle), Action(id: "stop", title: "Stop tour")]
	}
	var options: [TipOption] { [Tips.IgnoresDisplayFrequency(true)] }
}

private struct TutorialTipModifier: ViewModifier {
	let steps: [TutorialStep]
	let available: Bool
	let arrowEdge: Edge
	let onAdvance: () -> Void
	@State private var tutorial = TutorialStore.shared

	private var step: TutorialStep? {
		guard available, let current = tutorial.currentStep, steps.contains(current) else { return nil }
		return current
	}

	func body(content: Content) -> some View {
		let activeStep = step
		let generation = tutorial.generation
		let identity = activeStep.map { "\(generation)-\($0.rawValue)" } ?? "inactive"
		content.popoverTip(
			activeStep.map { TutorialTip(step: $0, generation: generation, isLastStep: tutorial.isLastStep) },
			isPresented: Binding(
				get: { activeStep != nil },
				set: { presented in
					if !presented, let activeStep {
						tutorial.stop(ifCurrent: activeStep, generation: generation)
					}
				}
			),
			arrowEdge: arrowEdge
		) { action in
			guard let activeStep, tutorial.currentStep == activeStep, tutorial.generation == generation else { return }
			if action.id == "next" {
				tutorial.advance(activeStep)
				onAdvance()
			} else if action.id == "stop" {
				tutorial.stop(ifCurrent: activeStep, generation: generation)
			}
		}
		.id(identity)
		.task(id: identity) {
			guard let activeStep else { return }
			TobyTips.configure()
			let tip = TutorialTip(step: activeStep, generation: generation)
			for await status in tip.statusUpdates {
				guard !Task.isCancelled, tutorial.currentStep == activeStep, tutorial.generation == generation else { return }
				if case .invalidated(let reason) = status, reason == .tipClosed {
					tutorial.stop(ifCurrent: activeStep, generation: generation)
				}
			}
		}
	}
}

extension View {
	/// Attach lessons to the actual control or section. Only the active lesson is eligible.
	func tutorialTip(
		_ steps: TutorialStep...,
		available: Bool = true,
		arrowEdge: Edge = .bottom,
		onAdvance: @escaping () -> Void = {}
	) -> some View {
		modifier(TutorialTipModifier(steps: steps, available: available, arrowEdge: arrowEdge, onAdvance: onAdvance))
	}
}
