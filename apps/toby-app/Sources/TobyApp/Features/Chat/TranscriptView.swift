import SwiftUI

struct TranscriptView: View {
	let entries: [TranscriptEntry]
	let streamingAssistant: StreamingAssistantState?
	var isLoading = false
	var turnWorkDurations: [Int: TimeInterval] = [:]
	var activeWorkStartDate: Date?
	var bottomContentPadding: CGFloat = 18
	var personaImageUrl: URL?
	/// When set and `store.activeAskUserPrompt` is non-nil, the interactive prompt
	/// is rendered as the last transcript control (not a modal overlay).
	var askUserStore: ChatStore?
	/// Overrides the General → Chat mode preference (mainly for previews/tests).
	var transcriptModeOverride: ChatTranscriptMode?
	private let bottomAnchorID = "transcript-bottom-anchor"
	private let askUserAnchorID = "transcript-ask-user-anchor"

	/// App-local chat mode (Settings → General). Uses the shared preferences
	/// singleton so ViewInspector tests need no environment injection.
	@State private var appearancePreferences = AppearancePreferences.shared
	@State private var expandedWorkGroups: Set<String> = []
	@State private var collapsedWhileActive: Set<String> = []

	private var transcriptMode: ChatTranscriptMode {
		transcriptModeOverride ?? appearancePreferences.chatTranscriptMode
	}

	private var displayItems: [TranscriptDisplayItem] {
		TranscriptGrouping.groupedItems(from: entries, isLoading: isLoading, mode: transcriptMode)
	}

	private var hasActiveAskUser: Bool {
		askUserStore?.activeAskUserPrompt != nil
	}

	private var showsWorkDetails: Bool {
		transcriptMode == .debug
	}

	private func isWorkGroupExpanded(_ group: TranscriptWorkGroup) -> Bool {
		guard showsWorkDetails else { return false }
		if workSteps(from: group).isEmpty { return false }
		if group.isActive {
			return !collapsedWhileActive.contains(group.id)
		}
		return expandedWorkGroups.contains(group.id)
	}

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				VStack(alignment: .leading, spacing: 22) {
					ForEach(displayItems) { item in
						switch item {
						case .entry(let entry, _):
							TranscriptRow(entry: entry, personaImage: personaImageUrl)
						case .workGroup(let group):
							WorkedForRow(
								group: group,
								duration: duration(for: group),
								activeWorkStartDate: group.isActive ? activeWorkStartDate : nil,
								isExpanded: isWorkGroupExpanded(group),
								onToggle: { toggleWorkGroup(group) },
								showsWorkDetails: showsWorkDetails,
								// Debug only: stream inside the expandable work log.
								// Normal mode streams in the main transcript below.
								streamingAssistant: showsWorkDetails
									&& group.isActive
									&& streamingAssistant?.inWorkArea == true
									? streamingAssistant
									: nil,
								personaImage: personaImageUrl,
							)
							.id(group.id)
						}
					}
					// In normal mode (non-expandable work chip), always stream in the
					// main transcript. In debug, tool-turn streams render inside the
					// active work group instead.
					if let streamingAssistant,
						transcriptMode == .normal || !streamingAssistant.inWorkArea
					{
						AssistantMessageRow(
							iconName: "sparkle",
							header: streamingAssistant.header,
							messageBody: streamingAssistant.text,
							isStreaming: true,
							personaImage: personaImageUrl,
						)
						.id("streaming")
					}
					if let askUserStore, askUserStore.activeAskUserPrompt != nil {
						AskUserPromptView(store: askUserStore)
							.id(askUserAnchorID)
					}
					Color.clear
						.frame(height: bottomContentPadding)
						.id(bottomAnchorID)
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, AppTheme.contentPadding)
				.padding(.top, 10)
			}
			.automaticScrollIndicators(axes: .vertical)
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			.onChange(of: entries.count) { _, _ in
				scrollToBottom(proxy: proxy)
			}
			.onChange(of: streamingAssistant?.text) { _, _ in
				scrollToBottom(proxy: proxy)
			}
			.onChange(of: hasActiveAskUser) { _, isActive in
				if isActive {
					scrollToBottom(proxy: proxy)
				}
			}
			.onChange(of: isLoading) { wasLoading, loading in
				if wasLoading, !loading {
					withAnimation(.easeOut(duration: 0.2)) {
						collapsedWhileActive.removeAll()
						for item in displayItems {
							if case .workGroup(let group) = item {
								expandedWorkGroups.remove(group.id)
							}
						}
					}
				}
			}
		}
	}

	private func duration(for group: TranscriptWorkGroup) -> TimeInterval? {
		if group.isActive, let started = activeWorkStartDate {
			return Date().timeIntervalSince(started)
		}
		if let durationMs = group.durationMs {
			return TimeInterval(durationMs) / 1000.0
		}
		guard let index = group.userTurnIndex else { return nil }
		return turnWorkDurations[index]
	}

	private func toggleWorkGroup(_ group: TranscriptWorkGroup) {
		guard showsWorkDetails else { return }
		if workSteps(from: group).isEmpty { return }
		if group.isActive {
			if collapsedWhileActive.contains(group.id) {
				collapsedWhileActive.remove(group.id)
			} else {
				collapsedWhileActive.insert(group.id)
			}
			return
		}
		if expandedWorkGroups.contains(group.id) {
			expandedWorkGroups.remove(group.id)
		} else {
			expandedWorkGroups.insert(group.id)
		}
	}

	private func scrollToBottom(proxy: ScrollViewProxy) {
		withAnimation(.easeOut(duration: 0.15)) {
			proxy.scrollTo(bottomAnchorID, anchor: .bottom)
		}
	}
}
