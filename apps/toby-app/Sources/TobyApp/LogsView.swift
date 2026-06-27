import AppKit
import SwiftUI
import STTextView

struct LogsView: View {
	@Bindable var store: LogsStore

	var body: some View {
		NavigationSplitView {
			LogsSidebarView(store: store)
				.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
				.toolbar(removing: .sidebarToggle)
				.toolbar {
					ToolbarItem(placement: .confirmationAction) {
						Button {} label: {
							Image(systemName: "doc.text")
								.foregroundStyle(.clear)
						}
						.disabled(true)
						.accessibilityHidden(true)
					}
				}
		} detail: {
			LogsDetailView(store: store)
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
		.task {
			store.refreshAvailableLogs()
			if let first = store.availableLogs.first {
				store.selectLog(first)
			}
		}
		.onDisappear {
			store.stopPolling()
		}
	}
}

struct LogsSidebarView: View {
	@Bindable var store: LogsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Logs")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.availableLogs.isEmpty {
						Text("No logs found")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.availableLogs) { log in
							Button {
								store.selectLog(log)
							} label: {
								LogSidebarRow(
									name: log.displayName,
									fileName: log.fileName,
									isSelected: store.selectedLog == log,
								)
							}
							.buttonStyle(.plain)
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
		}
		.background(AppTheme.sidebarBackground)
	}
}

private struct LogSidebarRow: View {
	let name: String
	let fileName: String
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "doc.text.fill")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				Text(name)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(fileName)
					.font(.caption2)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}

struct LogsDetailView: View {
	@Bindable var store: LogsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if let log = store.selectedLog {
				LogsDetailHeader(log: log)
				Divider()
					.background(AppTheme.separator)
				LogTextView(text: store.content)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.clipped()
			} else {
				ContentUnavailableView {
					Label("No log selected", systemImage: "doc.text")
				} description: {
					Text("Select a log from the sidebar to view its contents.")
				}
			}
		}
		.background(SettingsDesign.canvasBackground)
	}
}

private struct LogsDetailHeader: View {
	let log: LogsStore.LogDescriptor

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(log.displayName)
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Text(log.url.path)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(1)
				.truncationMode(.middle)
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(AppTheme.panelBackground)
	}
}

struct LogTextView: NSViewRepresentable {
	let text: String

	func makeCoordinator() -> Coordinator {
		Coordinator()
	}

	func makeNSView(context: Context) -> NSScrollView {
		let scrollView = STTextView.scrollableTextView()
		scrollView.hasVerticalScroller = true
		scrollView.hasHorizontalScroller = false
		scrollView.autohidesScrollers = false
		scrollView.drawsBackground = true
		scrollView.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)
		scrollView.contentView.drawsBackground = true
		scrollView.contentView.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)

		guard let textView = scrollView.documentView as? STTextView else {
			return scrollView
		}
		textView.showsLineNumbers = true
		textView.isEditable = false
		textView.isSelectable = true
		textView.isHorizontallyResizable = false
		textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
		textView.textColor = NSColor.white.withAlphaComponent(0.88)
		textView.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)

		return scrollView
	}

	func updateNSView(_ scrollView: NSScrollView, context: Context) {
		guard let textView = scrollView.documentView as? STTextView else { return }
		if textView.text != text {
			let shouldAutoScroll = context.coordinator.hasReceivedContent && isScrolledToBottom(scrollView)
			textView.text = text
			textView.needsLayout = true
			textView.needsDisplay = true
			context.coordinator.hasReceivedContent = true
			if shouldAutoScroll {
				DispatchQueue.main.async {
					self.scrollToBottomIfValid(scrollView)
				}
			}
		}
	}

	private func isScrolledToBottom(_ scrollView: NSScrollView) -> Bool {
		let visibleRect = scrollView.contentView.visibleRect
		let documentRect = scrollView.documentView?.bounds ?? .zero
		// Only consider "at bottom" if the document is actually larger than the viewport.
		guard documentRect.height > visibleRect.height + 2 else { return false }
		return visibleRect.maxY >= documentRect.maxY - 2
	}

	private func scrollToBottomIfValid(_ scrollView: NSScrollView) {
		let documentRect = scrollView.documentView?.bounds ?? .zero
		guard documentRect.height > 0 else { return }
		let maxY = documentRect.maxY - scrollView.contentView.bounds.height
		let targetY = max(0, maxY)
		scrollView.contentView.scroll(to: CGPoint(x: 0, y: targetY))
		scrollView.reflectScrolledClipView(scrollView.contentView)
	}

	final class Coordinator {
		var hasReceivedContent = false
	}
}
