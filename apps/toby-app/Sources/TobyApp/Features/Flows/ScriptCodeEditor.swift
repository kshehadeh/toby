@preconcurrency import CodeEditorView
import LanguageSupport
import SwiftUI

/// Native code editing with line numbers for both languages. TypeScript uses
/// lexical syntax coloring; AppleScript stays plain until it has a grammar.
struct ScriptCodeEditor: View {
	@Binding var source: String
	let language: String
	@Environment(\.colorScheme) private var colorScheme
	@State private var position = CodeEditor.Position()
	@State private var messages: Set<TextLocated<Message>> = []

	var body: some View {
		CodeEditor(
			text: $source,
			position: $position,
			messages: $messages,
			language: language == "typescript" ? .tobyTypeScript : .none
		)
		.environment(\.codeEditorTheme, Theme.toby(for: colorScheme))
		.environment(\.codeEditorLayoutConfiguration, .init(showMinimap: false, wrapText: false))
		.accessibilityIdentifier("script-tool-code-editor")
	}
}

extension LanguageConfiguration {
	@MainActor static let tobyTypeScript = LanguageConfiguration(
		name: "Toby TypeScript",
		supportsSquareBrackets: true,
		supportsCurlyBrackets: true,
		stringRegex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/,
		characterRegex: nil,
		numberRegex: /\b\d+(?:\.\d+)?\b/,
		singleLineComment: "//",
		nestedComment: (open: "/*", close: "*/"),
		identifierRegex: /[A-Za-z_$][A-Za-z0-9_$]*/,
		operatorRegex: /[+\-*%=!<>?&|^~.]+/,
		reservedIdentifiers: [
			"as", "async", "await", "break", "case", "catch", "class", "const", "continue",
			"debugger", "default", "delete", "do", "else", "enum", "export", "extends",
			"false", "finally", "for", "from", "function", "if", "implements", "import",
			"in", "instanceof", "interface", "let", "new", "null", "of", "private",
			"protected", "public", "return", "static", "super", "switch", "this", "throw",
			"true", "try", "type", "typeof", "undefined", "var", "void", "while", "yield"
		],
		reservedOperators: ["=>", "===", "!==", "==", "!=", "&&", "||", "??", "?."]
	)
}
