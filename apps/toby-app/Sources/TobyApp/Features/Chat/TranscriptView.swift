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
	/// Grouped rows when `cachedGroupingKey` matches the current inputs.
	@State private var cachedDisplayItems: [TranscriptDisplayItem] = []
	@State private var cachedGroupingKey: TranscriptGroupingKey?
	@State private var lastStreamingScrollAt: Date?
	@State private var trailingScrollTask: Task<Void, Never>?

	private var transcriptMode: ChatTranscriptMode {
		transcriptModeOverride ?? appearancePreferences.chatTranscriptMode
	}

	private var hasActiveAskUser: Bool {
		askUserStore?.activeAskUserPrompt != nil
	}

	private var currentGroupingKey: TranscriptGroupingKey {
		TranscriptGroupingKey(
			entries: entries,
			isLoading: isLoading,
			mode: transcriptMode,
		)
	}

	/// Prefer the state cache when the grouping key matches so streaming-only
	/// invalidations (activity line, token deltas) do not re-parse the history.
	/// Fall back to a live group when the key is cold/stale (first paint,
	/// ViewInspector) — never deep-`==` full transcript payloads in `body`.
	private var displayItems: [TranscriptDisplayItem] {
		if cachedGroupingKey == currentGroupingKey {
			return cachedDisplayItems
		}
		return TranscriptGrouping.groupedItems(
			from: entries,
			isLoading: isLoading,
			mode: transcriptMode,
		)
	}

	/// Both modes render the expandable work log so users can open the "Working"
	/// section and see the steps that ran. Normal mode still hides the skill/tool
	/// selection notices (see `TranscriptGrouping.isVisible`).
	private let showsWorkDetails = true

	private func isWorkGroupExpanded(_ group: TranscriptWorkGroup) -> Bool {
		// Do not call `workSteps(from:)` here — that re-parses every group on
		// every parent invalidation. Empty groups never need expansion UI.
		if group.entries.isEmpty { return false }
		if group.isActive {
			// Debug expands the live work log by default (opt-out); normal mode keeps
			// the active conversation clean and only expands when the user opts in.
			if transcriptMode == .debug {
				return !collapsedWhileActive.contains(group.id)
			}
			return expandedWorkGroups.contains(group.id)
		}
		return expandedWorkGroups.contains(group.id)
	}

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				// Lazy stack avoids laying out the full history on every parent tick
				// (e.g. streaming token updates that only touch the bottom row).
				LazyVStack(alignment: .leading, spacing: 22) {
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
								streamingAssistant: transcriptMode == .debug
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
			.onAppear {
				refreshDisplayItemsCache()
			}
			.onChange(of: currentGroupingKey, initial: true) { _, _ in
				refreshDisplayItemsCache()
				scrollToBottom(proxy: proxy, policy: .immediate)
			}
			.onChange(of: isLoading) { wasLoading, loading in
				// Grouping key already includes isLoading; also collapse work chips.
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
			.onChange(of: streamingAssistant?.text) { _, _ in
				scrollToBottom(proxy: proxy, policy: .throttled)
			}
			.onChange(of: hasActiveAskUser) { _, isActive in
				if isActive {
					scrollToBottom(proxy: proxy, policy: .immediate)
				}
			}
			.onDisappear {
				trailingScrollTask?.cancel()
				trailingScrollTask = nil
			}
		}
	}

	private func refreshDisplayItemsCache() {
		let key = currentGroupingKey
		cachedDisplayItems = TranscriptGrouping.groupedItems(
			from: entries,
			isLoading: isLoading,
			mode: transcriptMode,
		)
		cachedGroupingKey = key
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
		// Resolve expandability once on user action (not every body pass).
		if workSteps(from: group).isEmpty { return }
		// Debug uses opt-out collapse for the live (active) group; normal mode and
		// every completed group use opt-in expansion.
		if group.isActive, transcriptMode == .debug {
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

	private enum ScrollPolicy {
		case immediate
		case throttled
	}

	private func scrollToBottom(proxy: ScrollViewProxy, policy: ScrollPolicy) {
		switch policy {
		case .immediate:
			trailingScrollTask?.cancel()
			trailingScrollTask = nil
			lastStreamingScrollAt = Date()
			performScrollToBottom(proxy: proxy)
		case .throttled:
			let decision = TranscriptScrollThrottle.decision(lastScrollAt: lastStreamingScrollAt)
			if decision.scrollNow {
				trailingScrollTask?.cancel()
				trailingScrollTask = nil
				lastStreamingScrollAt = Date()
				performScrollToBottom(proxy: proxy)
				return
			}
			guard let delay = decision.trailingDelay else { return }
			// Coalesce trailing scrolls so a burst of deltas ends with one catch-up.
			trailingScrollTask?.cancel()
			trailingScrollTask = Task { @MainActor in
				let ns = UInt64(max(delay, 0) * 1_000_000_000)
				try? await Task.sleep(nanoseconds: ns)
				guard !Task.isCancelled else { return }
				lastStreamingScrollAt = Date()
				trailingScrollTask = nil
				performScrollToBottom(proxy: proxy)
			}
		}
	}

	private func performScrollToBottom(proxy: ScrollViewProxy) {
		withAnimation(.easeOut(duration: 0.15)) {
			proxy.scrollTo(bottomAnchorID, anchor: .bottom)
		}
	}
}

/// Lightweight fingerprint for transcript grouping inputs (not deep body equality).
struct TranscriptGroupingKey: Equatable {
	let count: Int
	let firstId: String?
	let lastId: String?
	let stampHash: Int
	let isLoading: Bool
	let mode: ChatTranscriptMode

	init(entries: [TranscriptEntry], isLoading: Bool, mode: ChatTranscriptMode) {
		count = entries.count
		firstId = entries.first?.id
		lastId = entries.last?.id
		var hash = 0
		for entry in entries {
			hash ^= entry.contentStamp
		}
		stampHash = hash
		self.isLoading = isLoading
		self.mode = mode
	}
}
