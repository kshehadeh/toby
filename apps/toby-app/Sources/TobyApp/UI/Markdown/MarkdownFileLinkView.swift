import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct MarkdownFileLinkView: View {
	let link: MarkdownFileLink
	var compact: Bool = false

	@State private var status: Status = .idle

	private enum Status: Equatable {
		case idle
		case downloaded
		case missing
		case failed(String)
	}

	var body: some View {
		HStack(spacing: compact ? 8 : 10) {
			Image(systemName: "doc")
				.font(.system(size: compact ? 12 : 13, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
				.frame(width: 16, alignment: .center)
			VStack(alignment: .leading, spacing: 2) {
				Text(link.filename)
					.font(compact ? AppTheme.transcriptCaptionFont : AppTheme.transcriptCalloutFont)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
					.truncationMode(.middle)
				if let statusText {
					Text(statusText)
						.font(AppTheme.transcriptCaptionFont)
						.foregroundStyle(statusForeground)
						.lineLimit(2)
				}
			}
			Spacer(minLength: 8)
			Button("Download") { download() }
				.buttonStyle(.plain)
				.font(AppTheme.transcriptCaptionFont.weight(.semibold))
				.foregroundStyle(AppTheme.accent)
				.accessibilityIdentifier("markdown-file-link-download")
			Button("Open") { open() }
				.buttonStyle(.plain)
				.font(AppTheme.transcriptCaptionFont.weight(.semibold))
				.foregroundStyle(AppTheme.secondaryText)
				.accessibilityIdentifier("markdown-file-link-open")
		}
		.padding(.horizontal, compact ? 10 : 12)
		.padding(.vertical, compact ? 8 : 10)
		.background(
			RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous)
				.fill(AppTheme.elevatedBackground.opacity(0.92))
		)
		.overlay(
			RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous)
				.stroke(AppTheme.separator)
		)
		.contextMenu {
			Button("Download") { download() }
			Button("Open") { open() }
			Button("Save As…") { saveAs() }
			Button("Reveal in Finder") { revealOriginal() }
		}
		.help("Download \(link.filename) to your Downloads folder, or open it")
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("markdown-file-link")
		.accessibilityLabel("Generated file \(link.filename)")
	}

	private var statusText: String? {
		switch status {
		case .idle: return nil
		case .downloaded: return "Saved to Downloads"
		case .missing: return "File not found"
		case .failed(let message): return message
		}
	}

	private var statusForeground: Color {
		switch status {
		case .downloaded: return AppTheme.secondaryText
		case .missing, .failed: return AppTheme.statusErrorForeground
		case .idle: return AppTheme.secondaryText
		}
	}

	private func sourceURL() -> URL? {
		link.resolvedFileURL()
	}

	private func requireExistingSource() -> URL? {
		guard let url = sourceURL() else {
			status = .missing
			return nil
		}
		var isDir: ObjCBool = false
		guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else {
			status = .missing
			return nil
		}
		return url
	}

	private func download() {
		guard let source = requireExistingSource() else { return }
		guard let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else {
			saveAs()
			return
		}
		let dest = MarkdownFileLink.uniqueURL(in: downloads, preferredFilename: link.filename)
		do {
			try FileManager.default.copyItem(at: source, to: dest)
			status = .downloaded
			RevealInFinder.reveal(path: dest.path)
		} catch {
			status = .failed("Could not save the file.")
		}
	}

	private func open() {
		guard let source = requireExistingSource() else { return }
		if RevealInFinder.openWithDefaultApp(path: source.path) {
			status = .idle
		} else {
			status = .failed("Could not open the file.")
		}
	}

	private func saveAs() {
		guard let source = requireExistingSource() else { return }
		let panel = NSSavePanel()
		panel.canCreateDirectories = true
		panel.isExtensionHidden = false
		panel.nameFieldStringValue = link.filename
		if let type = UTType(filenameExtension: (link.filename as NSString).pathExtension) {
			panel.allowedContentTypes = [type]
		}
		panel.message = "Choose where to save \(link.filename)"
		panel.prompt = "Save"
		guard panel.runModal() == .OK, let dest = panel.url else { return }
		do {
			if FileManager.default.fileExists(atPath: dest.path) {
				try FileManager.default.removeItem(at: dest)
			}
			try FileManager.default.copyItem(at: source, to: dest)
			status = .downloaded
			RevealInFinder.reveal(path: dest.path)
		} catch {
			status = .failed("Could not save the file.")
		}
	}

	private func revealOriginal() {
		guard let source = requireExistingSource() else { return }
		RevealInFinder.reveal(path: source.path)
	}
}
