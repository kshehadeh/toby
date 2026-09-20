import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct InputDock: View {
	@Binding var text: String
	let focus: FocusState<Bool>.Binding
	let isLoading: Bool
	let contextFillPercentage: Int?
	let contextWindowUnavailable: Bool
	let attachments: [ChatAttachmentDraft]
	let canAttachFiles: Bool
	let pdfOnlyAttachments: Bool
	let attachmentDisabledReason: String
	let onAttachFiles: ([URL]) -> Void
	let onRemoveAttachment: (UUID) -> Void
	let onSubmit: () -> Void
	let onCancel: () -> Void
	@State private var isFileImporterPresented = false

	init(
		text: Binding<String>,
		focus: FocusState<Bool>.Binding,
		isLoading: Bool,
		contextFillPercentage: Int?,
		contextWindowUnavailable: Bool,
		attachments: [ChatAttachmentDraft] = [],
		canAttachFiles: Bool = false,
		pdfOnlyAttachments: Bool = false,
		attachmentDisabledReason: String = "The selected model does not support file attachments.",
		onAttachFiles: @escaping ([URL]) -> Void = { _ in },
		onRemoveAttachment: @escaping (UUID) -> Void = { _ in },
		onSubmit: @escaping () -> Void,
		onCancel: @escaping () -> Void
	) {
		self._text = text
		self.focus = focus
		self.isLoading = isLoading
		self.contextFillPercentage = contextFillPercentage
		self.contextWindowUnavailable = contextWindowUnavailable
		self.attachments = attachments
		self.canAttachFiles = canAttachFiles
		self.pdfOnlyAttachments = pdfOnlyAttachments
		self.attachmentDisabledReason = attachmentDisabledReason
		self.onAttachFiles = onAttachFiles
		self.onRemoveAttachment = onRemoveAttachment
		self.onSubmit = onSubmit
		self.onCancel = onCancel
	}

	var body: some View {
		VStack(spacing: 0) {
			if !attachments.isEmpty {
				AttachmentChipRow(
					attachments: attachments,
					onRemove: onRemoveAttachment
				)
				.padding(.horizontal, 12)
				.padding(.top, 10)
				.transition(.opacity)
			}
			TextField(inputDockPlaceholder, text: $text, axis: .vertical)
				.focused(focus)
				.textFieldStyle(.plain)
				.font(.body)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(2 ... 6)
				.disabled(isLoading)
				.accessibilityIdentifier("chat-input")
				.onKeyPress(.return, phases: .down) { press in
					if press.modifiers.contains(.shift) {
						text.append("\n")
						return .handled
					}
					onSubmit()
					return .handled
				}
				.padding(.horizontal, 14)
				.padding(.top, 12)
				.padding(.bottom, 8)
			HStack(spacing: 8) {
				Button {
					isFileImporterPresented = true
				} label: {
					Image(systemName: "plus")
						.font(.body.weight(.semibold))
						.accessibilityLabel(pdfOnlyAttachments ? "Add a PDF" : "Add files")
				}
				.buttonStyle(.bordered)
				.buttonBorderShape(.circle)
				.controlSize(.regular)
				.disabled(!canUseAttachmentButton)
				.inputDockButtonHover(isEnabled: canUseAttachmentButton)
				.help(canUseAttachmentButton ? attachHelpText : attachmentDisabledReason)
				.accessibilityIdentifier("chat-attach-button")
				Spacer(minLength: 0)
				if let pct = contextFillPercentage {
					ContextFillGauge(percentage: pct)
				} else if contextWindowUnavailable {
					Button(action: {}) {
						Image(systemName: "slash.circle")
							.frame(width: 14, height: 14)
							.padding(4)
							.contentShape(Rectangle())
							.foregroundStyle(AppTheme.tertiaryText)
					}
						.buttonStyle(.plain)
						.help("Provider doesn't support context window information.")
						.accessibilityLabel("Provider doesn't support context window information")
						.accessibilityIdentifier("context-window-unavailable")
				}
				if isLoading {
					Button(action: onCancel) {
						Image(systemName: "stop.fill")
							.accessibilityLabel("Cancel")
					}
					.buttonStyle(.bordered)
					.buttonBorderShape(.circle)
					.controlSize(.regular)
					.inputDockButtonHover(isEnabled: true)
					.accessibilityIdentifier("chat-cancel-button")
				}
				Button(action: onSubmit) {
					Image(systemName: "arrow.up")
						.accessibilityLabel("Send")
						.font(.body.weight(.semibold))
				}
				.buttonStyle(.borderedProminent)
				.buttonBorderShape(.circle)
				.controlSize(.regular)
				.tint(canSubmit ? AppTheme.accent : Color.secondary)
				.disabled(!canSubmit)
				.inputDockButtonHover(isEnabled: canSubmit, isProminent: true)
				.accessibilityIdentifier("chat-send-button")
			}
			.padding(.horizontal, 12)
			.padding(.bottom, 10)
		}
		.glassEffect(
			.regular.interactive(),
			in: AppTheme.concentricRect(minimum: AppTheme.cornerRadius)
		)
		.fileImporter(
			isPresented: $isFileImporterPresented,
			allowedContentTypes: pdfOnlyAttachments ? [.pdf] : [.item],
			allowsMultipleSelection: true
		) { result in
			switch result {
			case .success(let urls):
				onAttachFiles(urls)
			case .failure:
				break
			}
		}
	}

	private var canSubmit: Bool {
		!isLoading && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
	}

	private var canUseAttachmentButton: Bool {
		!isLoading && canAttachFiles
	}

	private var attachHelpText: String {
		pdfOnlyAttachments ? "Add a PDF for Toby to read" : "Add files"
	}
}

private let inputDockPlaceholder = "Return to send · Shift+Return for newline"
private let inputDockImageThumbnailSize: CGFloat = 48

private struct InputDockButtonHover: ViewModifier {
	var isEnabled: Bool
	var isProminent: Bool = false
	@State private var isHovered = false
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	func body(content: Content) -> some View {
		content
			.pointerStyle(isEnabled ? .link : .default)
			.overlay {
				Circle()
					.fill(hoverFill)
					.allowsHitTesting(false)
			}
			.onHover { isHovered = $0 }
			.animation(reduceMotion ? nil : .easeInOut(duration: 0.14), value: isHovered)
	}

	private var hoverFill: Color {
		guard isEnabled, isHovered else { return .clear }
		return AppTheme.primaryText.opacity(isProminent ? 0.16 : 0.10)
	}
}

private extension View {
	func inputDockButtonHover(isEnabled: Bool, isProminent: Bool = false) -> some View {
		modifier(InputDockButtonHover(isEnabled: isEnabled, isProminent: isProminent))
	}
}

private struct AttachmentChipRow: View {
	let attachments: [ChatAttachmentDraft]
	let onRemove: (UUID) -> Void
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private static let dismissalAnimation: Animation = .easeInOut(duration: 0.5)

	var body: some View {
		ScrollView(.horizontal, showsIndicators: false) {
			HStack(spacing: 6) {
				ForEach(attachments) { attachment in
					AttachmentChip(attachment: attachment) {
						dismiss(attachment.id)
					}
					.transition(
						.opacity.combined(with: .scale(scale: 0.4, anchor: .center))
					)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	private func dismiss(_ id: UUID) {
		withAnimation(reduceMotion ? nil : Self.dismissalAnimation) {
			onRemove(id)
		}
	}
}

private struct AttachmentChip: View {
	let attachment: ChatAttachmentDraft
	let onRemove: () -> Void

	var body: some View {
		if attachment.isImagePreviewable, let image = attachment.previewThumbnail {
			AttachmentImageThumbnail(attachment: attachment, image: image, onRemove: onRemove)
		} else {
			fileChip
		}
	}

	private var fileChip: some View {
		HStack(spacing: 6) {
			Image(systemName: "paperclip")
				.font(.caption.weight(.semibold))
			Text(attachment.filename)
				.lineLimit(1)
			Text(formatAttachmentByteSize(attachment.byteSize))
				.foregroundStyle(AppTheme.tertiaryText)
			Button(action: onRemove) {
				Image(systemName: "xmark")
					.font(.caption2.weight(.bold))
					.frame(width: 16, height: 16)
			}
			.buttonStyle(.plain)
			.accessibilityLabel("Remove \(attachment.filename)")
		}
		.font(.caption)
		.foregroundStyle(AppTheme.secondaryText)
		.padding(.horizontal, 8)
		.padding(.vertical, 5)
		.background(
			Capsule(style: .continuous)
				.fill(AppTheme.selection)
		)
		.accessibilityIdentifier("chat-input-file-attachment")
	}
}

private struct AttachmentImageThumbnail: View {
	let attachment: ChatAttachmentDraft
	let image: NSImage
	let onRemove: () -> Void

	static let size: CGFloat = inputDockImageThumbnailSize

	var body: some View {
		ZStack(alignment: .topTrailing) {
			Image(nsImage: image)
				.resizable()
				.interpolation(.high)
				.scaledToFill()
				.frame(width: Self.size, height: Self.size)
				.clipShape(AppTheme.concentricRect(minimum: 8))
				.overlay(
					AppTheme.concentricRect(minimum: 8)
						.stroke(AppTheme.separator)
				)
				.accessibilityLabel("Image attachment \(attachment.filename)")

			Button(action: onRemove) {
				Image(systemName: "xmark.circle.fill")
					.font(.system(size: 14, weight: .semibold))
					.symbolRenderingMode(.palette)
					.foregroundStyle(AppTheme.secondaryText, AppTheme.elevatedBackground)
					.frame(width: 22, height: 22)
					.contentShape(Rectangle())
					.accessibilityHidden(true)
			}
			.buttonStyle(.plain)
			.padding(2)
			.accessibilityLabel("Remove \(attachment.filename)")
			.accessibilityIdentifier("chat-input-remove-attachment")
		}
		.help("\(attachment.filename) · \(formatAttachmentByteSize(attachment.byteSize))")
		.accessibilityIdentifier("chat-input-image-attachment")
	}
}

private extension ChatAttachmentDraft {
	var previewThumbnail: NSImage? {
		guard let data = Data(base64Encoded: dataBase64) else { return nil }
		let maxPixelSize = inputDockImageThumbnailSize * (NSScreen.main?.backingScaleFactor ?? 2)
		return ImageDownsampling.downsample(data: data, maxPixelSize: maxPixelSize)
			?? NSImage(data: data)
	}
}

private struct ContextFillGauge: View {
	let percentage: Int

	private var clampedPercentage: Int {
		min(100, max(0, percentage))
	}

	private var progress: CGFloat {
		CGFloat(clampedPercentage) / 100
	}

	var body: some View {
		Button(action: {}) {
			ZStack {
				Circle()
					.stroke(AppTheme.tertiaryText.opacity(0.38), lineWidth: 3)
				Circle()
					.trim(from: 0, to: progress)
					.stroke(
						contextFillColor(clampedPercentage),
						style: StrokeStyle(lineWidth: 3, lineCap: .round)
					)
					.rotationEffect(.degrees(-90))
			}
			.frame(width: 16, height: 16)
			.padding(4)
			.contentShape(Rectangle())
		}
			.buttonStyle(.plain)
			.help("Context window: \(clampedPercentage)% full")
			.accessibilityLabel("Context window")
			.accessibilityValue("\(clampedPercentage)%")
			.accessibilityIdentifier("context-fill-gauge")
	}

	private func contextFillColor(_ pct: Int) -> Color {
		switch pct {
		case 80...: return .orange
		case 60...: return AppTheme.secondaryText
		default: return AppTheme.tertiaryText
		}
	}
}
