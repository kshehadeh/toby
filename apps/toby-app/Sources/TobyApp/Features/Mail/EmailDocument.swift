import Foundation

/// Builds the page the reader shows for an HTML email, and decides what it may
/// reach. Email is untrusted: scripts never run, and remote images and styles
/// (which tell the sender the message was opened) wait for the reader's say.
enum EmailDocument {
	private static let remotePatterns = [
		#"\b(?:src|srcset|background|poster)\s*=\s*["']?\s*(?:https?:)?//"#,
		#"url\(\s*["']?\s*(?:https?:)?//"#,
		#"<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?//"#,
	]

	/// Whether the message refers to images or styles on the web.
	static func hasRemoteContent(_ html: String) -> Bool {
		remotePatterns.contains { html.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
	}

	static func contentSecurityPolicy(allowsRemoteContent: Bool) -> String {
		let shared = "default-src 'none'; script-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; "
		return shared + (allowsRemoteContent
			? "img-src data: https: http:; style-src 'unsafe-inline' https:; font-src data: https:; upgrade-insecure-requests"
			: "img-src data:; style-src 'unsafe-inline'; font-src data:")
	}

	/// The message inside a page whose policy comes first, so nothing in the
	/// message can loosen it. Parsers fold the message's own `<html>`/`<body>`
	/// tags into ours.
	static func page(for html: String, allowsRemoteContent: Bool) -> String {
		"""
		<!doctype html><html><head><meta charset="utf-8">
		<meta http-equiv="Content-Security-Policy" content="\(contentSecurityPolicy(allowsRemoteContent: allowsRemoteContent))">
		<meta name="referrer" content="no-referrer">
		<style>
		:root { color-scheme: light; }
		body { margin: 20px 24px; background: #fff; color: #1d1d1f; font: 14px/1.5 -apple-system, sans-serif; overflow-wrap: break-word; }
		blockquote { margin-left: 0; padding-left: 12px; border-left: 2px solid #d2d2d7; }
		pre { white-space: pre-wrap; }
		</style></head><body>
		\(html)
		</body></html>
		"""
	}

	/// Links the reader may hand to the system. Everything else is ignored.
	static func externalURL(_ url: URL?) -> URL? {
		guard let url, let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return nil }
		return url
	}

	/// Plain text with web and email addresses made clickable.
	static func linkedText(_ text: String) -> AttributedString {
		let result = NSMutableAttributedString(string: text)
		let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
		detector?.enumerateMatches(in: text, range: NSRange(text.startIndex..., in: text)) { match, _, _ in
			guard let match, let url = externalURL(match.url) else { return }
			result.addAttribute(.link, value: url, range: match.range)
		}
		return AttributedString(result)
	}
}
