import SwiftUI

struct TranscriptView: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

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
	/// Identity of the last history we pinned to the bottom (count + ends only).
	@State private var lastPinnedIdentity: TranscriptPinIdentity?
	/// How many older items above the default window are revealed.
	@State private var revealedOlderCount = 0
	/// User is near the bottom — only then auto-scroll on stream / new turns.
	/// Scrolling *up* clears this so layout/stream updates do not fight the user.
	@State private var isNearBottom = true

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

	/// Cap how many transcript rows we materialize in the lazy path.
	private static let defaultVisibleItems = 60
	private static let revealChunk = 40
	/// Prefer an eager stack under this size — LazyVStack materializing complex
	/// markdown rows while scrolling up is a common freeze source (worse in a
	/// narrow Projects split beside the inspector).
	private static let eagerStackLimit = 48

	private func isWorkGroupExpanded(_ group: TranscriptWorkGroup) -> Bool {
		if group.entries.isEmpty { return false }
		if group.isActive || group.errorText != nil {
			return !collapsedWhileActive.contains(group.id)
		}
		return expandedWorkGroups.contains(group.id)
	}

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				let items = displayItems
				let window = visibleWindow(itemCount: items.count)
				let useEagerStack = items.count <= Self.eagerStackLimit

				Group {
					if useEagerStack {
						// Full history laid out once — scrolling never materializes
						// new markdown rows (the freeze path when reading upward).
						VStack(alignment: .leading, spacing: 22) {
							transcriptStackContent(items: items, window: window)
						}
					} else {
						LazyVStack(alignment: .leading, spacing: 22) {
							transcriptStackContent(items: items, window: window)
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, AppTheme.contentPadding)
				.padding(.top, 10)
			}
			// Do NOT use defaultScrollAnchor(.bottom): when the user scrolls up and
			// content height changes (LazyVStack / padding / inspector reflow), the
			// bottom anchor fights scroll offset and freezes the main thread.
			.automaticScrollIndicators(axes: .vertical)
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			.modifier(TranscriptNearBottomTracker(isNearBottom: $isNearBottom))
			.onAppear {
				refreshDisplayItemsCache()
			}
			.onChange(of: currentGroupingKey, initial: true) { _, newKey in
				refreshDisplayItemsCache()
				let identity = TranscriptPinIdentity(from: newKey)
				// New conversation / appended turns: reset the history window and
				// pin once. Ignore stamp-only updates (body growth mid-turn).
				if lastPinnedIdentity != identity {
					let isNewSession = lastPinnedIdentity?.firstId != identity.firstId
						|| lastPinnedIdentity == nil
					if isNewSession {
						revealedOlderCount = 0
						isNearBottom = true
					}
					lastPinnedIdentity = identity
					// Only pin when the user is following the bottom (or new session).
					if isNearBottom || isNewSession {
						isNearBottom = true
						DispatchQueue.main.async {
							scrollToBottom(proxy: proxy, policy: .immediate)
						}
					}
				}
			}
			.onChange(of: isLoading) { wasLoading, loading in
				if wasLoading, !loading {
					withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
						collapsedWhileActive.removeAll()
						for item in displayItems {
							if case .workGroup(let group) = item, group.errorText == nil {
								expandedWorkGroups.remove(group.id)
							}
						}
					}
				}
			}
			.onChange(of: streamingAssistant?.text) { _, _ in
				guard isNearBottom else { return }
				scrollToBottom(proxy: proxy, policy: .throttled)
			}
			.onChange(of: hasActiveAskUser) { _, isActive in
				if isActive, isNearBottom {
					scrollToBottom(proxy: proxy, policy: .immediate)
				}
			}
			.onDisappear {
				trailingScrollTask?.cancel()
				trailingScrollTask = nil
			}
		}
	}

	@ViewBuilder
	private func transcriptStackContent(
		items: [TranscriptDisplayItem],
		window: (start: Int, range: Range<Int>),
	) -> some View {
		if window.start > 0 {
			Button {
				revealedOlderCount += Self.revealChunk
			} label: {
				Text("Show \(min(Self.revealChunk, window.start)) earlier messages")
					.font(.caption.weight(.medium))
					.foregroundStyle(AppTheme.accent)
					.frame(maxWidth: .infinity)
					.padding(.vertical, 10)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("transcript-show-earlier")
		}

		ForEach(Array(items[window.range]), id: \.id) { item in
			transcriptItemView(item)
		}

		if let streamingAssistant {
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

	@ViewBuilder
	private func transcriptItemView(_ item: TranscriptDisplayItem) -> some View {
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
			)
			.id(group.id)
		}
	}

	private func visibleWindow(itemCount: Int) -> (start: Int, range: Range<Int>) {
		// Eager path always shows everything; window only applies to lazy stacks.
		if itemCount <= Self.eagerStackLimit {
			return (0, 0..<itemCount)
		}
		let base = Self.defaultVisibleItems + max(0, revealedOlderCount)
		if itemCount <= base {
			return (0, 0..<itemCount)
		}
		let start = itemCount - base
		return (start, start..<itemCount)
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
		// Cheap expandability check — do not parse work steps until expanded.
		if group.entries.isEmpty { return }
		if group.isActive || group.errorText != nil {
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
		var transaction = Transaction()
		transaction.disablesAnimations = true
		withTransaction(transaction) {
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
		// Prefer stable boxed-step ids over hashing full user/assistant text.
		firstId = entries.first.map(Self.stableId(for:))
		lastId = entries.last.map(Self.stableId(for:))
		var hash = 0
		// Sample stamps instead of walking huge payloads on every body eval.
		if entries.isEmpty {
			hash = 0
		} else if entries.count <= 64 {
			for entry in entries {
				hash ^= entry.contentStamp
			}
		} else {
			hash ^= entries[0].contentStamp
			hash ^= entries[entries.count / 2].contentStamp
			hash ^= entries[entries.count - 1].contentStamp
			hash ^= entries.count
		}
		stampHash = hash
		self.isLoading = isLoading
		self.mode = mode
	}

	private static func stableId(for entry: TranscriptEntry) -> String {
		switch entry {
		case .boxedStep(let payload):
			return "boxed-\(payload.id)-\(payload.seq)"
		case .toolCall(let blockKey, _, _):
			return "tool-call-\(blockKey)"
		case .toolOutput(let blockKey, _, _):
			return "tool-output-\(blockKey)"
		case .askUserQA(let blockKey, _, _, _):
			return "ask-user-\(blockKey)"
		case .turnWork(let durationMs):
			return "turn-work-\(durationMs)"
		case .user(let text, _):
			return "user-\(text.count)"
		case .assistant(let text):
			return "assistant-\(text.count)"
		case .meta(let text):
			return "meta-\(text.count)"
		case .notice(let text, _):
			return "notice-\(text.count)"
		case .error(let text):
			return "error-\(text.count)"
		}
	}
}

/// Count + endpoints only — used to decide when to pin scroll / reset window.
struct TranscriptPinIdentity: Equatable {
	let count: Int
	let firstId: String?
	let lastId: String?
	let isLoading: Bool
	let mode: ChatTranscriptMode

	init(from key: TranscriptGroupingKey) {
		count = key.count
		firstId = key.firstId
		lastId = key.lastId
		isLoading = key.isLoading
		mode = key.mode
	}
}

/// Tracks whether the transcript is scrolled near the bottom.
private struct TranscriptNearBottomTracker: ViewModifier {
	@Binding var isNearBottom: Bool

	func body(content: Content) -> some View {
		content.onScrollGeometryChange(for: Bool.self) { geometry in
			let viewHeight = geometry.containerSize.height
			let maxY = geometry.contentOffset.y + viewHeight
			let contentHeight = geometry.contentSize.height
			return contentHeight <= viewHeight + 1
				|| maxY >= contentHeight - 120
		} action: { _, nearBottom in
			if nearBottom != isNearBottom {
				isNearBottom = nearBottom
			}
		}
	}
}
