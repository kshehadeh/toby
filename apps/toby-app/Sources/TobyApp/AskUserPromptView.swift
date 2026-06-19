import SwiftUI

struct AskUserPromptView: View {
	@Bindable var store: ChatStore

	var body: some View {
		VStack(spacing: 0) {
			Spacer()
			VStack(alignment: .leading, spacing: 18) {
				promptHeader
				optionList
				cancelButton
			}
			.padding(22)
			.frame(maxWidth: 520)
			.background(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.fill(AppTheme.panelBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.stroke(AppTheme.separator)
			)
			.shadow(color: .black.opacity(0.28), radius: 36, y: 14)
			.padding(.horizontal, AppTheme.contentPadding)
			.padding(.bottom, 160)
			Spacer()
		}
		.background(.black.opacity(0.42))
		.ignoresSafeArea()
	}

	@ViewBuilder
	private var promptHeader: some View {
		HStack(spacing: 10) {
			Image(systemName: "questionmark.bubble.fill")
				.font(.title3.weight(.semibold))
				.foregroundStyle(AppTheme.accent)
			Text(store.activeAskUserPrompt?.query ?? "")
				.font(.headline.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)
				.fixedSize(horizontal: false, vertical: true)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	@ViewBuilder
	private var optionList: some View {
		if let prompt = store.activeAskUserPrompt {
			VStack(spacing: 8) {
				ForEach(Array(prompt.options.enumerated()), id: \.offset) { index, option in
					Button {
						store.submitAskUserOption(index: index)
					} label: {
						AskUserOptionRow(number: index + 1, label: option)
					}
					.buttonStyle(.plain)
				}
				AskUserCustomOptionRow(store: store, number: prompt.options.count + 1)
			}
		}
	}

	@ViewBuilder
	private var cancelButton: some View {
		HStack {
			Spacer()
			Button {
				store.cancelAskUserPrompt()
			} label: {
				Text("Cancel")
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.secondaryText)
					.padding(.horizontal, 12)
					.padding(.vertical, 6)
			}
			.buttonStyle(.plain)
		}
	}
}

private struct AskUserOptionRow: View {
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

private struct AskUserCustomOptionRow: View {
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
						return .ignored
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
