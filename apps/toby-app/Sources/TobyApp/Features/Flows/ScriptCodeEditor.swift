@preconcurrency import CodeEditorView
import LanguageSupport
import SwiftUI

/// Native code editing with line numbers and lexical syntax coloring.
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
			language: language == "typescript" ? .tobyTypeScript : .tobyAppleScript
		)
		.environment(\.codeEditorTheme, Theme.toby(for: colorScheme))
		.environment(\.codeEditorLayoutConfiguration, .init(showMinimap: false, wrapText: false))
		.accessibilityIdentifier("script-tool-code-editor")
	}
}

extension LanguageConfiguration {
	@MainActor static let tobyAppleScript = LanguageConfiguration(
		name: "Toby AppleScript",
		supportsSquareBrackets: false,
		supportsCurlyBrackets: true,
		caseInsensitiveReservedIdentifiers: true,
		stringRegex: /"(?:\\.|[^"\\])*"/,
		// CodeEditorView supports one line-comment marker. Its otherwise unused
		// character token colors AppleScript's second marker through end of line.
		characterRegex: /#[^\r\n]*/,
		numberRegex: /\b\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?\b/,
		singleLineComment: "--",
		nestedComment: (open: "(*", close: "*)"),
		identifierRegex: /\|(?:\\.|[^|\\])*\||[A-Za-z][A-Za-z0-9_]*/,
		operatorRegex: /[+\-*\/=<>≠≤≥&^]+/,
		reservedIdentifiers: [
			"about", "above", "after", "against", "and", "around", "as", "at",
			"back", "before", "beginning", "behind", "below", "beneath", "beside",
			"between", "but", "by", "considering", "contain", "contains",
			"continue", "copy", "div", "does", "eighth", "else", "end", "equal",
			"equals", "error", "every", "exit", "false", "fifth", "first", "for",
			"fourth", "from", "front", "get", "given", "global", "if", "ignoring",
			"in", "into", "is", "it", "its", "last", "local", "me", "middle",
			"mod", "my", "ninth", "not", "of", "on", "onto", "or", "over",
			"prop", "property", "put", "ref", "reference", "repeat", "return",
			"returning", "script", "second", "set", "seventh", "since", "sixth",
			"some", "tell", "tenth", "that", "the", "then", "third", "through",
			"thru", "timeout", "times", "to", "transaction", "true", "try",
			"until", "where", "while", "whose", "with", "without"
		],
		reservedOperators: []
	)

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
