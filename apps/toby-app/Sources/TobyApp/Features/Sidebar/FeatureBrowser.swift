import AppKit
import SwiftUI

enum FeatureBrowserMetrics {
	static let columnMinWidth: CGFloat = 200
	static let columnIdealWidth: CGFloat = 240
	static let columnMaxWidth: CGFloat = 280
	static let detailMinWidth: CGFloat = 360
	static let narrowThreshold: CGFloat = 720
	static let horizontalInset: CGFloat = 10
	static let verticalInset: CGFloat = 8
	static let rowSpacing: CGFloat = 2
	static let rowContentSpacing: CGFloat = 12
	static let rowHorizontalPadding: CGFloat = 10
	static let rowVerticalPadding: CGFloat = 8
	static let rowCornerRadius: CGFloat = 8
	static let glyphSize: CGFloat = 20
	/// Bounded empty-area hit target after the last row. Must stay finite —
	/// `maxHeight: .infinity` inside a `ScrollView` hangs layout on macOS.
	static let deselectFillHeight: CGFloat = 220
}

/// Shared list/detail split used by Chats and every other workspace browser.
///
/// Implemented as a SwiftUI `HStack` (not `HSplitView` / nested
/// `NavigationSplitView`) so the record list stays under the window toolbar
/// separator instead of flattening into a full-height title-bar column.
struct FeatureWorkspaceSplit<Browser: View, Detail: View>: View {
	let listTitle: String
	let isShowingList: Bool
	let onShowList: () -> Void
	@ViewBuilder var browser: () -> Browser
	@ViewBuilder var detail: () -> Detail

	@State private var isNarrow = false
	@State private var listWidth = FeatureBrowserMetrics.columnIdealWidth

	var body: some View {
		Group {
			if isNarrow {
				if isShowingList {
					browser()
				} else {
					detail()
				}
			} else {
				HStack(spacing: 0) {
					browser()
						.frame(width: listWidth)
						.frame(maxHeight: .infinity)
					FeatureWorkspaceResizeHandle(listWidth: $listWidth)
					detail()
						.frame(
							minWidth: FeatureBrowserMetrics.detailMinWidth,
							maxWidth: .infinity,
							maxHeight: .infinity
						)
				}
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.onGeometryChange(for: CGFloat.self) { proxy in
			proxy.size.width
		} action: { width in
			guard width > 0 else { return }
			isNarrow = width < FeatureBrowserMetrics.narrowThreshold
		}
		.toolbar {
			if isNarrow && !isShowingList {
				ToolbarItem(placement: .navigation) {
					Button {
						onShowList()
					} label: {
						Label(listTitle, systemImage: "chevron.backward")
					}
					.help("Show \(listTitle.lowercased())")
					.accessibilityLabel("Show \(listTitle.lowercased())")
					.accessibilityIdentifier("feature-browser-back-button")
				}
			}
		}
		.accessibilityIdentifier("feature-workspace-split")
	}
}

/// Hairline grabber between the workspace list and detail.
private struct FeatureWorkspaceResizeHandle: View {
	@Binding var listWidth: CGFloat
	@State private var isDragging = false
	@State private var widthAtDragStart = FeatureBrowserMetrics.columnIdealWidth

	var body: some View {
		Rectangle()
			.fill(AppTheme.separator)
			.frame(width: 1)
			.frame(maxHeight: .infinity)
			.padding(.horizontal, 4)
			.contentShape(Rectangle())
			.padding(.horizontal, -4)
			.pointerStyle(.columnResize)
			.gesture(
				DragGesture(minimumDistance: 1)
					.onChanged { value in
						if !isDragging {
							isDragging = true
							widthAtDragStart = listWidth
						}
						listWidth = min(
							max(
								widthAtDragStart + value.translation.width,
								FeatureBrowserMetrics.columnMinWidth
							),
							FeatureBrowserMetrics.columnMaxWidth
						)
					}
					.onEnded { _ in
						isDragging = false
					}
			)
			.accessibilityHidden(true)
	}
}

/// Shared second-sidebar chrome: inset so row selection does not touch the split edge.
struct FeatureBrowserList<Content: View>: View {
	let isLoading: Bool
	let isEmpty: Bool
	let loadingText: String
	let emptyText: String
	var onClearSelection: (() -> Void)? = nil
	@ViewBuilder var content: () -> Content

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if isLoading && isEmpty {
				caption(loadingText)
			} else if isEmpty {
				caption(emptyText)
			} else {
				FeatureBrowserDeselectingScroll(onClearSelection: onClearSelection) {
					LazyVStack(alignment: .leading, spacing: FeatureBrowserMetrics.rowSpacing) {
						content()
					}
					.padding(.horizontal, FeatureBrowserMetrics.horizontalInset)
					.padding(.vertical, FeatureBrowserMetrics.verticalInset)
				}
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
		.accessibilityIdentifier("feature-browser-list")
	}

	private func caption(_ text: String) -> some View {
		Text(text)
			.font(.caption)
			.foregroundStyle(AppTheme.tertiaryText)
			.padding(.horizontal, FeatureBrowserMetrics.horizontalInset)
			.padding(.vertical, 7)
	}
}

/// Scrolls a list and appends a *bounded* empty-area clear-selection control
/// below the rows. Do not put `GeometryReader` or `maxHeight: .infinity` in
/// this scroll content — both hang SwiftUI layout on macOS when a row click
/// relayouts the split. The fill is a sibling `Button` so it is not a parent
/// `onTapGesture` of the row buttons (that deadlocks AppKit click delivery).
struct FeatureBrowserDeselectingScroll<Content: View>: View {
	var onClearSelection: (() -> Void)? = nil
	@ViewBuilder var content: () -> Content

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 0) {
				content()
				if let onClearSelection {
					FeatureBrowserDeselectArea(action: onClearSelection)
				}
			}
			.frame(maxWidth: .infinity, alignment: .topLeading)
		}
		.automaticScrollIndicators(axes: .vertical)
	}
}

/// Hit target for “click empty list space to deselect”.
struct FeatureBrowserDeselectArea: View {
	let action: () -> Void

	var body: some View {
		Button(action: {
			// Tear down any AppKit first responder (skill/schedule markdown
			// editor) before the click that dismissed it also removes the view.
			AppKitFocus.resignTextViewIfNeeded()
			action()
		}) {
			Color.clear
				.frame(maxWidth: .infinity)
				.frame(height: FeatureBrowserMetrics.deselectFillHeight)
				.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.accessibilityLabel("Clear selection")
		.accessibilityIdentifier("feature-browser-list-deselect")
	}
}

/// Detail placeholder when the workspace has no selected record.
struct FeatureBrowserPlaceholder: View {
	let systemImage: String
	/// Short state title, for example “No skill selected”.
	let title: String
	/// Leading clause, for example “Select a skill”. Omit for a link-only empty state.
	var prompt: String? = nil
	var onCreate: (() -> Void)? = nil
	var createPhrase: String = "create a new one"
	var createAccessibilityIdentifier: String = "feature-browser-placeholder-create"

	var body: some View {
		ContentUnavailableView {
			Label(title, systemImage: systemImage)
		} description: {
			message
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
		.accessibilityIdentifier("feature-browser-placeholder")
	}

	@ViewBuilder
	private var message: some View {
		if let onCreate {
			if let prompt {
				HStack(spacing: 0) {
					Text("\(prompt) or ")
					createLink(action: onCreate)
					Text(".")
				}
				.fixedSize(horizontal: false, vertical: true)
			} else {
				createLink(action: onCreate)
			}
		} else if let prompt {
			Text("\(prompt) from the list.")
		}
	}

	private func createLink(action: @escaping () -> Void) -> some View {
		Button(createPhrase, action: action)
			.buttonStyle(.plain)
			.foregroundStyle(AppTheme.accent)
			.accessibilityIdentifier(createAccessibilityIdentifier)
	}
}
