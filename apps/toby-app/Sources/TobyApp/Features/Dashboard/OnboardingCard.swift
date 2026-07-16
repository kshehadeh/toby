import SwiftUI

struct OnboardingCard: View {
	let checklist: OnboardingChecklist
	let onStepAction: (OnboardingStepKind) -> Void

	private let columnCount = 3

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			header
			ProgressBar(progress: checklist.progress)
				.frame(height: 3)

			// Use Grid (not LazyVGrid) so height is deterministic inside Dashboard ScrollView.
			Grid(horizontalSpacing: 12, verticalSpacing: 12) {
				ForEach(0..<rowCount, id: \.self) { row in
					GridRow {
						ForEach(0..<columnCount, id: \.self) { col in
							let index = row * columnCount + col
							if index < checklist.steps.count {
								let step = checklist.steps[index]
								OnboardingStepTile(
									step: step,
									isUpNext: step.kind == checklist.upNextKind,
									onAction: { onStepAction(step.kind) }
								)
								.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
							}
						}
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
				.stroke(AppTheme.accent.opacity(0.25), lineWidth: 1)
		)
		.accessibilityIdentifier("dashboard-onboarding-card")
	}

	private var rowCount: Int {
		Int(ceil(Double(checklist.steps.count) / Double(columnCount)))
	}

	private var header: some View {
		HStack(alignment: .firstTextBaseline) {
			Text("Finish setting up Toby")
				.font(.system(size: 15, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			HStack(spacing: 0) {
				Text("\(checklist.completedCount)")
					.foregroundStyle(AppTheme.accent)
				Text(" of \(checklist.totalCount) done")
					.foregroundStyle(AppTheme.secondaryText)
			}
			.font(.system(size: 13, weight: .medium))
		}
	}
}

// MARK: - Step tile

private struct OnboardingStepTile: View {
	let step: OnboardingStep
	let isUpNext: Bool
	let onAction: () -> Void

	private static let completedGreen = Color(red: 0.35, green: 0.75, blue: 0.45)
	private static let tileMinHeight: CGFloat = 148
	private static let tileCornerRadius: CGFloat = 12

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if isUpNext {
				Text("UP NEXT")
					.font(.system(size: 9, weight: .bold))
					.foregroundStyle(Color.black.opacity(0.85))
					.padding(.horizontal, 7)
					.padding(.vertical, 3)
					.background(
						Capsule()
							.fill(AppTheme.accent)
					)
					.padding(.bottom, 10)
			}

			topRow
				.padding(.bottom, 10)

			Text(step.title)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(step.isComplete ? AppTheme.tertiaryText : AppTheme.primaryText)
				.lineLimit(2)
				.fixedSize(horizontal: false, vertical: true)

			Text(step.subtitle)
				.font(.system(size: 11))
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(2)
				.padding(.top, 4)

			Spacer(minLength: 12)

			bottomRow
		}
		.padding(14)
		.frame(maxWidth: .infinity, minHeight: Self.tileMinHeight, alignment: .topLeading)
		.background(
			RoundedRectangle(cornerRadius: Self.tileCornerRadius)
				.fill(tileBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: Self.tileCornerRadius)
				.stroke(tileBorder, lineWidth: 1)
		)
	}

	private var topRow: some View {
		HStack(alignment: .top) {
			Image(systemName: step.systemImage)
				.font(.system(size: 15, weight: .medium))
				.foregroundStyle(step.isComplete ? AppTheme.tertiaryText : AppTheme.secondaryText)
				.frame(width: 22, height: 22, alignment: .leading)

			Spacer(minLength: 0)

			if step.isComplete {
				Image(systemName: "checkmark.circle.fill")
					.font(.system(size: 16))
					.foregroundStyle(AppTheme.accent)
			}
		}
	}

	@ViewBuilder
	private var bottomRow: some View {
		if step.isComplete {
			Text("Completed")
				.font(.system(size: 12, weight: .medium))
				.foregroundStyle(Self.completedGreen)
		} else if let label = step.actionLabel {
			Button(action: onAction) {
				HStack(spacing: 6) {
					Spacer(minLength: 0)
					Text(label)
						.font(.system(size: 12, weight: .semibold))
					Image(systemName: "arrow.right")
						.font(.system(size: 10, weight: .semibold))
					Spacer(minLength: 0)
				}
				.foregroundStyle(isUpNext ? Color.black.opacity(0.85) : AppTheme.primaryText)
				.padding(.vertical, 8)
				.background(
					RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
						.fill(isUpNext ? AppTheme.accent : AppTheme.elevatedBackground)
				)
				.overlay {
					if !isUpNext {
						RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
							.stroke(AppTheme.separator, lineWidth: 1)
					}
				}
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("onboarding-action-\(step.kind.rawValue)")
		}
	}

	private var tileBackground: Color {
		if isUpNext {
			return AppTheme.accent.opacity(0.10)
		}
		return AppTheme.elevatedBackground
	}

	private var tileBorder: Color {
		if isUpNext {
			return AppTheme.accent.opacity(0.55)
		}
		return AppTheme.separator
	}
}

// MARK: - Progress

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
