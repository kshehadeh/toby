import AlertToast
import SwiftUI

struct RootView: View {
	@Bindable var store: ChatStore
	@Bindable var configureStore: ConfigureStore
	@Environment(\.openWindow) private var openWindow
	@State private var isCommandPalettePresented = false
	@State private var pendingDeleteSession: SessionSummary?
	@State private var isToastHovered = false
	@State private var toastDismissTask: Task<Void, Never>?

	private let toastDuration: UInt64 = 4_000_000_000

	var body: some View {
		NavigationSplitView {
			AppSidebar(
				sessions: store.sessions,
				selectedSessionId: store.sessionId,
				status: store.status,
				isLoading: store.isLoading,
				isSessionsLoading: store.isSessionsLoading,
				isRecording: store.isRecordingActive,
				isRecordDisabled: store.isRecordButtonDisabled,
				onNewChat: startNewChat,
				onSearch: { isCommandPalettePresented = true },
				onToggleRecording: toggleRecording,
				onSelectSession: selectSession,
				onDeleteSession: { pendingDeleteSession = $0 },
				onOpenSettings: openSettings,
				onOpenRecordings: openRecordings,
				onOpenPersonasSettings: openPersonasSettings,
				onPersonaSelected: refreshStatus,
			)
			.navigationSplitViewColumnWidth(
				min: 220,
				ideal: AppTheme.sidebarWidth,
				max: 320,
			)
		} detail: {
			ChatWorkspaceView(store: store)
		}
		.overlay(alignment: .top) {
			if let toast = store.toast {
				alertToast(for: toast)
					.frame(maxWidth: 420)
					.padding(.horizontal, 16)
					.padding(.top, 16)
					.contentShape(Rectangle())
					.onHover { hovering in
						isToastHovered = hovering
						if hovering {
							toastDismissTask?.cancel()
							toastDismissTask = nil
						} else {
							scheduleToastDismiss()
						}
					}
					.onTapGesture {
						dismissToast()
					}
					.transition(.move(edge: .top).combined(with: .opacity))
			}
		}
		.animation(.spring(response: 0.28, dampingFraction: 0.82), value: store.toast?.id)
		.onChange(of: store.toast?.id) { _, id in
			isToastHovered = false
			if id == nil {
				toastDismissTask?.cancel()
				toastDismissTask = nil
			} else {
				scheduleToastDismiss()
			}
		}
		.onDisappear {
			toastDismissTask?.cancel()
			toastDismissTask = nil
		}
		.task {
			await store.bootstrap()
		}
		.sheet(isPresented: $isCommandPalettePresented) {
			CommandPaletteView(
				sessions: store.sessions,
				onSelectSession: selectSession,
				onNewChat: startNewChat,
				onOpenSettings: { openSettings() },
				onDismiss: { isCommandPalettePresented = false },
			)
			.presentationBackground(.clear)
		}
		.onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
			isCommandPalettePresented = true
		}
		.onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
			startNewChat()
		}
		.alert(
			"Delete Session?",
			isPresented: Binding(
				get: { pendingDeleteSession != nil },
				set: { if !$0 { pendingDeleteSession = nil } },
			),
			presenting: pendingDeleteSession,
		) { session in
			Button("Cancel", role: .cancel) {
				pendingDeleteSession = nil
			}
			Button("Delete", role: .destructive) {
				pendingDeleteSession = nil
				Task { await store.deleteSession(id: session.id) }
			}
		} message: { session in
			Text("Are you sure you want to delete \"\(session.name)\"? This cannot be undone.")
		}
	}

	private func startNewChat() {
		Task { await store.startNewSession() }
	}

	private func selectSession(_ id: String) {
		Task { await store.selectSession(id: id) }
	}

	private func toggleRecording() {
		Task { await store.toggleRecording() }
	}

	private func openSettings(navKey: String? = nil) {
		if let navKey {
			configureStore.selectedNavKey = navKey
		}
		openWindow(id: "settings")
	}

	private func openRecordings() {
		openWindow(id: "recordings")
	}

	private func openPersonasSettings() {
		openSettings(navKey: "personas")
	}

	private func refreshStatus() {
		Task { await store.refreshStatus() }
	}

	private func scheduleToastDismiss() {
		toastDismissTask?.cancel()
		guard store.toast != nil, !isToastHovered else { return }
		toastDismissTask = Task {
			try? await Task.sleep(nanoseconds: toastDuration)
			guard !Task.isCancelled else { return }
			await MainActor.run {
				if !isToastHovered {
					store.toast = nil
					toastDismissTask = nil
				}
			}
		}
	}

	private func dismissToast() {
		toastDismissTask?.cancel()
		toastDismissTask = nil
		store.toast = nil
		isToastHovered = false
	}

	private func alertToast(for toast: AppToastState) -> AlertToast {
		switch toast.style {
		case .success:
			return AlertToast(
				displayMode: .banner(.slide),
				type: .complete(.green),
				title: toast.title,
				subTitle: toastSubtitle(toast.message),
			)
		case .error:
			return AlertToast(
				displayMode: .banner(.slide),
				type: .error(.red),
				title: toast.title,
				subTitle: toastSubtitle(toast.message),
			)
		}
	}

	private func toastSubtitle(_ message: String?) -> String? {
		guard let message else { return nil }
		let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
		guard trimmed.count > 120 else { return trimmed }
		return "\(trimmed.prefix(117))..."
	}
}

extension Notification.Name {
	static let openCommandPalette = Notification.Name("openCommandPalette")
	static let startNewChat = Notification.Name("startNewChat")
}
