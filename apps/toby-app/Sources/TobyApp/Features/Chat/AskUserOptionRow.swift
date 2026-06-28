import SwiftUI

struct AskUserOptionRow: View {
	let number: Int
	let label: String

	var body: some View {
		HStack(spacing: 10) {
			Text("\(number).")
				.font(.callout.weight(.semibold))
				.foregroundStyle(AppTheme.accent)
				.frame(width: 28, alignment: .leading)
			Text(label)
				.font(.body)
				.foregroundStyle(AppTheme.primaryText)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(.horizontal, 14)
		.padding(.vertical, 11)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(AppTheme.elevatedBackground.opacity(0.54))
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(AppTheme.separator)
		)
	}
}

struct AskUserCustomOptionRow: View {
	@Bindable var store: ChatStore
	let number: Int
	@State private var text = ""
	@FocusState private var isFocused: Bool

	var body: some View {
		HStack(spacing: 10) {
			Text("\(number).")
				.font(.callout.weight(.semibold))
				.foregroundStyle(AppTheme.accent)
				.frame(width: 28, alignment: .leading)
			TextField("Type your own answer", text: $text, axis: .vertical)
				.textFieldStyle(.plain)
				.focused($isFocused)
				.font(.body)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1 ... 3)
				.onKeyPress(.return, phases: .down) { press in
					if press.modifiers.contains(.shift) {
						text.append("\n")
						return .handled
					}
					submit()
					return .handled
				}
				.padding(.vertical, 2)
			Button {
				submit()
			} label: {
				Image(systemName: "arrow.up")
					.frame(width: 24, height: 24)
					.background(
						Circle()
							.fill(canSubmit ? AppTheme.primaryText : AppTheme.selection)
					)
					.foregroundStyle(canSubmit ? AppTheme.contentBackground : AppTheme.tertiaryText)
			}
			.buttonStyle(.plain)
			.disabled(!canSubmit)
		}
		.padding(.leading, 14)
		.padding(.trailing, 10)
		.padding(.vertical, 9)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(AppTheme.elevatedBackground.opacity(0.42))
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.stroke(AppTheme.separator)
		)
		.onAppear {
			isFocused = true
		}
	}

	private var canSubmit: Bool {
		!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	private func submit() {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		store.submitAskUserCustomAnswer(trimmed)
	}
}
