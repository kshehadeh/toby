import SwiftUI
import AppKit

struct IssueReportView: View {
	@Bindable var store: ChatStore
	let onDismiss: () -> Void

	@State private var type = "bug"
	@State private var details = ""
	@FocusState private var focusedField: Field?

	private enum Field: Hashable {
		case type
		case details
	}

	private let maxLength = 2000

	var body: some View {
		VStack(alignment: .leading, spacing: 24) {
			Text("Report app issue")
				.font(.title2)
				.fontWeight(.bold)
				.foregroundStyle(AppTheme.primaryText)
				.padding(.top, 8)

			Picker(selection: $type) {
				Text("Bug").tag("bug")
				Text("Feature").tag("feature")
			} label: {
				EmptyView()
			}
			.pickerStyle(.segmented)
			.accessibilityLabel("Issue type")
			.focused($focusedField, equals: .type)

			Text("What happened?")
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)

			ZStack(alignment: .topLeading) {
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(AppTheme.elevatedBackground)

				if details.isEmpty {
					Text("Tell us about the issue you encountered")
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(16)
						.allowsHitTesting(false)
				}

				IssueReportTextEditor(
					text: $details,
					maxLength: maxLength,
					onSubmit: submit
				)
				.padding(12)
				.frame(minWidth: 320, minHeight: 160)
				.focused($focusedField, equals: .details)
			}
			.frame(minWidth: 320, minHeight: 160)

			HStack {
				Spacer()
				Text("\(details.count) / \(maxLength)")
					.font(.caption)
					.foregroundStyle(AppTheme.secondaryText)
			}

			Text("Any information you share may be reviewed to help improve Toby.")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)

			HStack {
				Spacer()
				Button("Cancel", role: .cancel) {
					onDismiss()
				}
				Button("Submit") {
					submit()
				}
				.keyboardShortcut(.return, modifiers: [.command])
				.disabled(details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
			}
		}
		.padding(32)
		.frame(minWidth: 440, maxWidth: 440, minHeight: 400)
		.defaultFocus($focusedField, .type)
	}

	private func submit() {
		let trimmed = details.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		onDismiss()
		Task { await store.submitIssue(type: type, details: trimmed) }
	}
}

private struct IssueReportTextEditor: NSViewRepresentable {
	@Binding var text: String
	let maxLength: Int
	let onSubmit: () -> Void

	func makeNSView(context: Context) -> NSScrollView {
		let textView = IssueReportTextView()
		textView.onSubmit = onSubmit
		textView.maxLength = maxLength
		textView.delegate = context.coordinator
		textView.backgroundColor = .clear
		textView.isRichText = false
		textView.isAutomaticQuoteSubstitutionEnabled = false
		textView.isAutomaticDashSubstitutionEnabled = false
		textView.font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
		textView.textColor = NSColor.textColor
		textView.isVerticallyResizable = true
		textView.isHorizontallyResizable = false
		textView.textContainer?.widthTracksTextView = true
		textView.textContainer?.containerSize = NSSize(width: 10000000, height: 10000000)
		textView.maxSize = NSSize(width: 10000000, height: 10000000)

		let scrollView = NSScrollView()
		scrollView.documentView = textView
		scrollView.hasVerticalScroller = true
		scrollView.autohidesScrollers = true
		scrollView.drawsBackground = false

		return scrollView
	}

	func updateNSView(_ nsView: NSScrollView, context: Context) {
		guard let textView = nsView.documentView as? NSTextView else { return }
		if textView.string != text {
			context.coordinator.isUpdating = true
			textView.string = text
			context.coordinator.isUpdating = false
		}
	}

	func makeCoordinator() -> Coordinator {
		Coordinator(self)
	}

	final class Coordinator: NSObject, NSTextViewDelegate {
		let parent: IssueReportTextEditor
		var isUpdating = false

		init(_ parent: IssueReportTextEditor) {
			self.parent = parent
		}

		func textDidChange(_ notification: Notification) {
			guard !isUpdating else { return }
			guard let textView = notification.object as? NSTextView else { return }
			let current = textView.string
			if current.count > parent.maxLength {
				let trimmed = String(current.prefix(parent.maxLength))
				parent.text = trimmed
			} else {
				parent.text = current
			}
		}
	}
}

private final class IssueReportTextView: NSTextView {
	var maxLength = Int.max
	var onSubmit: (() -> Void)?

	override func keyDown(with event: NSEvent) {
		let isCommandReturn = event.modifierFlags.contains(.command) &&
			(event.keyCode == 36 || event.keyCode == 76)
		if isCommandReturn {
			onSubmit?()
			return
		}
		super.keyDown(with: event)
	}

	override func doCommand(by selector: Selector) {
		switch selector {
		case #selector(insertTab(_:)):
			window?.selectNextKeyView(nil)
		case #selector(insertBacktab(_:)):
			window?.selectPreviousKeyView(nil)
		default:
			super.doCommand(by: selector)
		}
	}
}
