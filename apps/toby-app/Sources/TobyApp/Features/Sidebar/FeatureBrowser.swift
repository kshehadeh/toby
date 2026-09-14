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
	@ViewBuilder var content: () -> Content

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if isLoading && isEmpty {
				Text(loadingText)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.padding(.horizontal, FeatureBrowserMetrics.horizontalInset)
					.padding(.vertical, 7)
			} else if isEmpty {
				Text(emptyText)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.padding(.horizontal, FeatureBrowserMetrics.horizontalInset)
					.padding(.vertical, 7)
			} else {
				ScrollView {
					LazyVStack(alignment: .leading, spacing: FeatureBrowserMetrics.rowSpacing) {
						content()
					}
					.padding(.horizontal, FeatureBrowserMetrics.horizontalInset)
					.padding(.vertical, FeatureBrowserMetrics.verticalInset)
					.frame(maxWidth: .infinity, alignment: .leading)
				}
				.automaticScrollIndicators(axes: .vertical)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
		.accessibilityIdentifier("feature-browser-list")
	}
}

/// Detail placeholder when the workspace has no selected record.
struct FeatureBrowserPlaceholder: View {
	let systemImage: String
	/// Leading clause, for example “Select a skill”.
	let prompt: String
	var onCreate: (() -> Void)? = nil
	var createPhrase: String = "create a new one"
	var createAccessibilityIdentifier: String = "feature-browser-placeholder-create"

	var body: some View {
		VStack(spacing: 16) {
			Image(systemName: systemImage)
				.font(.system(size: 56, weight: .regular))
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityHidden(true)
			message
				.font(.body)
				.foregroundStyle(AppTheme.secondaryText)
				.multilineTextAlignment(.center)
				.frame(maxWidth: 360)
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
		.accessibilityIdentifier("feature-browser-placeholder")
		.accessibilityLabel(accessibilityLabel)
	}

	@ViewBuilder
	private var message: some View {
		if let onCreate {
			HStack(spacing: 0) {
				Text("\(prompt) or ")
				Button(createPhrase, action: onCreate)
					.buttonStyle(.plain)
					.foregroundStyle(AppTheme.accent)
					.accessibilityIdentifier(createAccessibilityIdentifier)
				Text(".")
			}
			.fixedSize(horizontal: false, vertical: true)
		} else {
			Text("\(prompt) from the list.")
		}
	}

	private var accessibilityLabel: String {
		if onCreate != nil {
			return "\(prompt) or \(createPhrase)."
		}
		return "\(prompt) from the list."
	}
}
