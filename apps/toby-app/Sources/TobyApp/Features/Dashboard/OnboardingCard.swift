import SwiftUI

struct OnboardingCard: View {
	let checklist: OnboardingChecklist
	let onStepAction: (OnboardingStepKind) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			HStack(alignment: .firstTextBaseline) {
				Text("Finish setting up Toby")
					.font(.system(size: 15, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
				Spacer()
				HStack(spacing: 0) {
					Text("\(checklist.completedCount)")
						.foregroundStyle(AppTheme.accent)
					Text(" of \(checklist.totalCount)")
						.foregroundStyle(AppTheme.secondaryText)
				}
				.font(.system(size: 13, weight: .medium))
			}

			ProgressBar(progress: checklist.progress)
				.frame(height: 4)

			VStack(alignment: .leading, spacing: 2) {
				ForEach(checklist.steps) { step in
					OnboardingStepRow(step: step) {
						onStepAction(step.kind)
					}
				}
			}
		}
		.padding(20)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.fill(AppTheme.panelBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
		.accessibilityIdentifier("dashboard-onboarding-card")
	}
}

private struct OnboardingStepRow: View {
	let step: OnboardingStep
	let action: () -> Void

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: step.isComplete ? "checkmark.circle.fill" : "circle")
				.font(.system(size: 16))
				.foregroundStyle(step.isComplete ? AppTheme.accent : AppTheme.tertiaryText)

			Text(step.title)
				.font(.system(size: 13))
				.strikethrough(step.isComplete, color: AppTheme.tertiaryText)
				.foregroundStyle(step.isComplete ? AppTheme.tertiaryText : AppTheme.primaryText)

			Spacer()

			if !step.isComplete, let label = step.actionLabel {
				Button(action: action) {
					Text(label)
						.font(.system(size: 12, weight: .medium))
						.foregroundStyle(AppTheme.primaryText)
						.padding(.horizontal, 12)
						.padding(.vertical, 5)
						.background(
							RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
								.fill(AppTheme.elevatedBackground)
						)
						.overlay(
							RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
								.stroke(AppTheme.separator, lineWidth: 1)
						)
				}
				.buttonStyle(.plain)
				.accessibilityIdentifier("onboarding-action-\(step.kind.rawValue)")
			}
		}
		.padding(.vertical, 6)
	}
}

struct ProgressBar: View {
	let progress: Double

	var body: some View {
		GeometryReader { proxy in
			ZStack(alignment: .leading) {
				Capsule()
					.fill(Color.white.opacity(0.1))
				Capsule()
					.fill(AppTheme.accent)
					.frame(width: max(0, min(1, progress)) * proxy.size.width)
			}
		}
	}
}
