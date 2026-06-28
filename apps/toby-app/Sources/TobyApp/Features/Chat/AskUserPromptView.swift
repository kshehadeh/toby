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
