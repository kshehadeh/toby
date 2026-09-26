import Foundation
import LanguageSupport
import Testing
@testable import TobyApp

@MainActor
struct ScriptCodeEditorTests {
	@Test("AppleScript source has case-insensitive keywords, literals, and comments")
	func appleScriptTokens() throws {
		let configuration = LanguageConfiguration.tobyAppleScript
		let tokeniser = try #require(LanguageConfiguration.Tokeniser(
			for: configuration.tokenDictionary,
			caseInsensitiveReservedIdentifiers: configuration.caseInsensitiveReservedIdentifiers
		))
		let source = #"""
		ON run argv
		set greeting to "Hello \"Toby\"" & 3.5
		-- a line comment
		# another line comment
		(* outer (* inner *) comment *)
		return greeting
		"""#
		let tokens = source.tokenise(with: tokeniser, state: .tokenisingCode)
		let lexemes = tokens.map { (text: (source as NSString).substring(with: $0.range), token: $0.token) }

		#expect(lexemes.contains { $0.text == "ON" && $0.token == .keyword })
		#expect(lexemes.contains { $0.text == "set" && $0.token == .keyword })
		#expect(lexemes.contains { $0.text == "return" && $0.token == .keyword })
		#expect(lexemes.contains { $0.text == "greeting" && $0.token == .identifier(nil) })
		#expect(lexemes.contains { $0.text.contains("Toby") && $0.token == .string })
		#expect(lexemes.contains { $0.text == "3.5" && $0.token == .number })
		#expect(lexemes.contains { $0.text == "--" && $0.token == .singleLineComment })
		#expect(lexemes.contains { $0.text == "# another line comment" && $0.token == .character })
		#expect(lexemes.filter { $0.text == "(*" && $0.token == .nestedCommentOpen }.count == 2)
		#expect(lexemes.filter { $0.text == "*)" && $0.token == .nestedCommentClose }.count == 2)
	}
}
