import SwiftUI

struct InputDock: View {
	@Binding var text: String
	let focus: FocusState<Bool>.Binding
	let isLoading: Bool
	let contextFillPercentage: Int?
	let contextWindowUnavailable: Bool
	let onSubmit: () -> Void
	let onCancel: () -> Void

	var body: some View {
		VStack(spacing: 0) {
			TextField("Ask Toby to handle something", text: $text, axis: .vertical)
				.focused(focus)
				.textFieldStyle(.plain)
				.font(.body)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(2 ... 6)
				.disabled(isLoading)
				.accessibilityIdentifier("chat-input")
				.onKeyPress(.return, phases: .down) { press in
					if press.modifiers.contains(.shift) {
						text.append("\n")
						return .handled
					}
					onSubmit()
					return .handled
				}
				.padding(.horizontal, 14)
				.padding(.top, 12)
				.padding(.bottom, 8)
			HStack(spacing: 8) {
				Text("Return to send")
				Text("Shift+Return for newline")
					.foregroundStyle(AppTheme.tertiaryText)
				Spacer()
				if let pct = contextFillPercentage {
					ContextFillGauge(percentage: pct)
				} else if contextWindowUnavailable {
					Button(action: {}) {
						Image(systemName: "slash.circle")
							.frame(width: 14, height: 14)
							.padding(4)
							.contentShape(Rectangle())
							.foregroundStyle(AppTheme.tertiaryText)
					}
						.buttonStyle(.plain)
						.help("Provider doesn't support context window information.")
						.accessibilityLabel("Provider doesn't support context window information")
						.accessibilityIdentifier("context-window-unavailable")
				}
				if isLoading {
					Button(action: onCancel) {
						Image(systemName: "stop.fill")
							.accessibilityLabel("Cancel")
							.frame(width: 26, height: 26)
							.background(
								Circle()
									.fill(AppTheme.selection)
							)
							.foregroundStyle(AppTheme.tertiaryText)
					}
					.buttonStyle(.plain)
					.accessibilityIdentifier("chat-cancel-button")
				}
				Button(action: onSubmit) {
					Image(systemName: "arrow.up")
						.accessibilityLabel("Send")
						.frame(width: 26, height: 26)
						.background(
							Circle()
								.fill(canSubmit ? AppTheme.primaryText : AppTheme.selection)
						)
						.foregroundStyle(canSubmit ? AppTheme.contentBackground : AppTheme.tertiaryText)
				}
				.buttonStyle(.plain)
				.disabled(!canSubmit)
				.accessibilityIdentifier("chat-send-button")
			}
			.font(.caption)
			.foregroundStyle(AppTheme.secondaryText)
			.padding(.horizontal, 12)
			.padding(.bottom, 10)
		}
		.background(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.fill(AppTheme.contentBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.stroke(AppTheme.separator)
		)
		.shadow(color: .black.opacity(0.16), radius: 20, y: 12)
	}

	private var canSubmit: Bool {
		!isLoading && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}
}

private struct ContextFillGauge: View {
	let percentage: Int

	private var clampedPercentage: Int {
		min(100, max(0, percentage))
	}

	private var progress: CGFloat {
		CGFloat(clampedPercentage) / 100
	}

	var body: some View {
		Button(action: {}) {
			ZStack {
				Circle()
					.stroke(AppTheme.tertiaryText.opacity(0.38), lineWidth: 3)
				Circle()
					.trim(from: 0, to: progress)
					.stroke(
						contextFillColor(clampedPercentage),
						style: StrokeStyle(lineWidth: 3, lineCap: .round)
					)
					.rotationEffect(.degrees(-90))
			}
			.frame(width: 16, height: 16)
			.padding(4)
			.contentShape(Rectangle())
		}
			.buttonStyle(.plain)
			.help("Context window: \(clampedPercentage)% full")
			.accessibilityLabel("Context window")
			.accessibilityValue("\(clampedPercentage)%")
			.accessibilityIdentifier("context-fill-gauge")
	}

	private func contextFillColor(_ pct: Int) -> Color {
		switch pct {
		case 80...: return .orange
		case 60...: return AppTheme.secondaryText
		default: return AppTheme.tertiaryText
		}
	}
}
