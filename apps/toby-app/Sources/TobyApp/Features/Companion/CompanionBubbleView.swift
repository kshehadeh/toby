import SwiftUI

struct CompanionBubbleView: View {
	@Bindable var store: CompanionStore
	let close: () -> Void
	let hide: () -> Void
	@FocusState private var composerFocused: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack {
				Text("How can I help?").font(.headline)
				Spacer()
				Button("Start over", systemImage: "plus.bubble") { store.reset() }
					.labelStyle(.iconOnly).help("Start a new chat").disabled(store.isThinking)
				Menu {
					Button("Hide desktop companion", action: hide)
				} label: { Image(systemName: "ellipsis") }
					.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Companion options")
				Button("Close conversation", systemImage: "xmark", action: close)
					.labelStyle(.iconOnly).help("Close conversation")
			}
			if store.hasConversation {
				TranscriptView(entries: store.conversationEntries,
					streamingAssistant: store.chat.streamingAssistant,
					isLoading: store.chat.isLoading,
					turnWorkDurations: store.chat.turnWorkDurations,
					activeWorkStartDate: store.chat.activeWorkStartDate,
					askUserStore: store.chat,
					transcriptModeOverride: .normal)
				if store.isThinking {
					HStack(spacing: 8) {
						ProgressView().controlSize(.small)
						Text(store.activityLabel)
					}.font(.caption).foregroundStyle(AppTheme.secondaryText)
				}
			}
			if let error = store.errorMessage {
				ScrollView {
					InlineStatusMessage(message: error, tone: .error, font: .caption, allowsTextSelection: true)
				}.frame(maxHeight: 80)
			}
			VStack(spacing: 8) {
				TextEditor(text: $store.draft)
					.font(.body).scrollContentBackground(.hidden)
					.frame(height: 66).focused($composerFocused)
					.accessibilityLabel("Question for Toby")
					.accessibilityIdentifier("companion-composer")
					.overlay(alignment: .topLeading) {
						if store.draft.isEmpty {
							Text("Ask Toby…").foregroundStyle(AppTheme.tertiaryText)
								.font(.body).padding(.leading, 5).allowsHitTesting(false)
								.accessibilityHidden(true)
						}
					}
					.disabled(store.isThinking)
				HStack {
					Text("⌘Return to send").font(.caption).foregroundStyle(AppTheme.secondaryText)
					Spacer()
					if store.isThinking {
						Button("Stop", systemImage: "stop.fill") { store.stop() }.disabled(!store.canStop)
					} else {
						Button("Send", systemImage: "arrow.up") { store.send() }
							.keyboardShortcut(.return, modifiers: .command)
							.disabled(!store.canSubmit).tint(AppTheme.accent)
					}
				}
			}
			.padding(10).background(AppTheme.elevatedBackground, in: .rect(cornerRadius: 14))
		}
		.padding(16)
		.padding(store.bubblePointsRight ? .trailing : .leading, 12)
		.frame(width: store.bubbleSize.width, height: store.bubbleSize.height)
		.foregroundStyle(AppTheme.primaryText)
		.background(AppTheme.contentBackground, in: CompanionBubbleShape(pointsRight: store.bubblePointsRight, tailY: store.bubbleTailY))
		.overlay(CompanionBubbleShape(pointsRight: store.bubblePointsRight, tailY: store.bubbleTailY).stroke(AppTheme.separator, lineWidth: 1))
		.task(id: store.presentationID) {
			await Task.yield()
			composerFocused = true
		}
		.onExitCommand(perform: close)
	}
}
