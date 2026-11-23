import AppKit
import SwiftUI
import WebKit

/// Renders an HTML email with scripts off, no stored cookies, and remote
/// content blocked until allowed. Links open in the default browser. Messages
/// are written for white paper, so it stays light in both appearances.
struct EmailHTMLView: NSViewRepresentable {
	let html: String
	let allowsRemoteContent: Bool

	func makeCoordinator() -> Coordinator { Coordinator() }

	func makeNSView(context: Context) -> WKWebView {
		let configuration = WKWebViewConfiguration()
		configuration.websiteDataStore = .nonPersistent()
		configuration.defaultWebpagePreferences.allowsContentJavaScript = false
		configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
		let view = WKWebView(frame: .zero, configuration: configuration)
		view.navigationDelegate = context.coordinator
		view.appearance = NSAppearance(named: .aqua)
		view.allowsLinkPreview = false
		view.allowsBackForwardNavigationGestures = false
		view.setAccessibilityLabel("Message")
		return view
	}

	func updateNSView(_ view: WKWebView, context: Context) {
		context.coordinator.show(html, allowsRemoteContent: allowsRemoteContent, in: view)
	}

	static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) {
		coordinator.cancel()
		view.stopLoading()
	}

	@MainActor
	final class Coordinator: NSObject, WKNavigationDelegate {
		private var shown: (html: String, allowsRemoteContent: Bool)?
		private var loading: Task<Void, Never>?

		/// Backstop behind the page's policy: covers preconnect and prefetch too.
		private static let blockRemoteRules = """
		[{"trigger":{"url-filter":"^https?:"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?:"},"action":{"type":"block"}}]
		"""

		func show(_ html: String, allowsRemoteContent: Bool, in view: WKWebView) {
			if let shown, shown.html == html, shown.allowsRemoteContent == allowsRemoteContent { return }
			shown = (html, allowsRemoteContent)
			loading?.cancel()
			loading = Task { [weak view] in
				let rules = allowsRemoteContent ? nil : try? await WKContentRuleListStore.default()?.compileContentRuleList(
					forIdentifier: "toby.email.block-remote", encodedContentRuleList: Self.blockRemoteRules
				)
				guard !Task.isCancelled, let view else { return }
				let controller = view.configuration.userContentController
				controller.removeAllContentRuleLists()
				if let rules { controller.add(rules) }
				view.loadHTMLString(EmailDocument.page(for: html, allowsRemoteContent: allowsRemoteContent), baseURL: nil)
			}
		}

		func cancel() { loading?.cancel() }

		func webView(
			_: WKWebView,
			decidePolicyFor action: WKNavigationAction,
			decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
		) {
			// Our own page, and links within it.
			if action.request.url?.scheme == "about" {
				decisionHandler(.allow)
				return
			}
			// Only a click leaves the message; redirects and forms go nowhere.
			if action.navigationType == .linkActivated, let url = EmailDocument.externalURL(action.request.url) {
				NSWorkspace.shared.open(url)
			}
			decisionHandler(.cancel)
		}
	}
}
