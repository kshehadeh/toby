import SwiftUI

/// Bottom-trailing toast host: auto-dismiss, hover pause, and action routing.
/// Owns dismiss-task state so shells (`RootView`) do not.
struct AppToastHost: View {
	@Bindable var store: ChatStore
	var onAction: (AppToastAction) -> Void

	@State private var isHovered = false
	@State private var dismissTask: Task<Void, Never>?

	private let dismissDurationNanoseconds: UInt64 = 4_000_000_000

	private var isProcessingToast: Bool {
		store.recordingProcessing?.isActive == true
	}

	var body: some View {
		Group {
			if let toast = store.toast {
				ToastView(
					toast: toast,
					onDismiss: dismissToast,
					onAction: onAction,
				)
				.frame(maxWidth: 420)
				.padding(.horizontal, 16)
				.padding(.bottom, 16)
				.contentShape(Rectangle())
				.onHover { hovering in
					isHovered = hovering
					if hovering {
						dismissTask?.cancel()
						dismissTask = nil
					} else {
						scheduleDismiss()
					}
				}
				.onTapGesture {
					if !isProcessingToast {
						dismissToast()
					}
				}
				.transition(.move(edge: .bottom).combined(with: .opacity))
			}
		}
		.animation(.spring(response: 0.28, dampingFraction: 0.82), value: store.toast?.id)
		.onChange(of: store.toast?.id) { (_: UUID?, id: UUID?) in
			isHovered = false
			if id == nil {
				dismissTask?.cancel()
				dismissTask = nil
			} else {
				scheduleDismiss()
			}
		}
		.onDisappear {
			dismissTask?.cancel()
			dismissTask = nil
		}
	}

	private func scheduleDismiss() {
		dismissTask?.cancel()
		guard store.toast != nil, !isHovered, !isProcessingToast else { return }
		dismissTask = Task {
			try? await Task.sleep(nanoseconds: dismissDurationNanoseconds)
			guard !Task.isCancelled else { return }
			await MainActor.run {
				if !isHovered && !isProcessingToast {
					store.toast = nil
					dismissTask = nil
				}
			}
		}
	}

	private func dismissToast() {
		dismissTask?.cancel()
		dismissTask = nil
		store.toast = nil
		store.recordingProcessing = nil
		isHovered = false
	}
}
