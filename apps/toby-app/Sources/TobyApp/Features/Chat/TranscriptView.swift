import AppKit
import SwiftUI

struct TranscriptView: View {
	let entries: [TranscriptEntry]
	let streamingAssistant: StreamingAssistantState?
	var isLoading = false
	var turnWorkDurations: [Int: TimeInterval] = [:]
	var activeWorkStartDate: Date?
	var bottomContentPadding: CGFloat = 18
	var personaImageUrl: URL?
	private let bottomAnchorID = "transcript-bottom-anchor"

	@State private var expandedWorkGroups: Set<String> = []
	@State private var collapsedWhileActive: Set<String> = []
	@State private var isScrolling = false
	@State private var scrollProgress: CGFloat = 0
	@State private var scrollViewHeight: CGFloat = 220

	private let scrollbarWidth: CGFloat = 6
	private let scrollbarHeight: CGFloat = 86

	private var displayItems: [TranscriptDisplayItem] {
		TranscriptGrouping.groupedItems(from: entries, isLoading: isLoading)
	}

	private func isWorkGroupExpanded(_ group: TranscriptWorkGroup) -> Bool {
		if workSteps(from: group).isEmpty { return false }
		if group.isActive {
			return !collapsedWhileActive.contains(group.id)
		}
		return expandedWorkGroups.contains(group.id)
	}

	var body: some View {
		ScrollViewReader { proxy in
			ZStack(alignment: .trailing) {
				ScrollView(.vertical, showsIndicators: false) {
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
									streamingAssistant: group.isActive && streamingAssistant?.inWorkArea == true
										? streamingAssistant
										: nil,
									personaImage: personaImageUrl,
								)
								.id(group.id)
							}
						}
						if let streamingAssistant, !streamingAssistant.inWorkArea {
							AssistantMessageRow(
								iconName: "sparkle",
								header: streamingAssistant.header,
								messageBody: streamingAssistant.text,
								isStreaming: true,
								personaImage: personaImageUrl,
							)
							.id("streaming")
						}
						Color.clear
							.frame(height: bottomContentPadding)
							.id(bottomAnchorID)
						ScrollStateTracker(
							isScrolling: $isScrolling,
							progress: $scrollProgress
						)
						.frame(width: 0, height: 0)
					}
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.horizontal, AppTheme.contentPadding)
					.padding(.top, 10)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
				.background(
					GeometryReader { geometry in
						Color.clear
							.onAppear { scrollViewHeight = geometry.size.height }
							.onChange(of: geometry.size.height) { _, newValue in
								scrollViewHeight = newValue
							}
					}
				)

				if isScrolling {
					RoundedRectangle(cornerRadius: scrollbarWidth / 2)
						.fill(AppTheme.tertiaryText.opacity(0.58))
						.frame(width: scrollbarWidth, height: scrollbarHeight)
						.padding(.trailing, 4)
						.offset(y: (scrollProgress - 0.5) * max(scrollViewHeight - scrollbarHeight, 0))
						.transition(.opacity)
						.allowsHitTesting(false)
				}
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			.animation(.easeInOut(duration: 0.25), value: isScrolling)
			.onChange(of: entries.count) { _, _ in
				scrollToBottom(proxy: proxy)
			}
			.onChange(of: streamingAssistant?.text) { _, _ in
				scrollToBottom(proxy: proxy)
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
