import SwiftUI

struct InputDock: View {
	@Binding var text: String
	let focus: FocusState<Bool>.Binding
	let isLoading: Bool
	let onSubmit: () -> Void

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
