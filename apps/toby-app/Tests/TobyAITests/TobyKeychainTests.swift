import Foundation
import Testing
@testable import TobyAI

@Suite("Toby keychain vault")
struct TobyKeychainTests {
	@Test func migratesReadableLegacyItemsAndSkipsOnesNeedingApproval() throws {
		let backend = MemoryKeychain()
		backend.seed("imap.example.com", service: "app.toby.secrets", account: "mail.imapHost")
		backend.seed("hunter2", service: "app.toby.secrets", account: "mail.imapPassword", needsApproval: true)
		backend.seed("sk-or-1", service: "app.toby.openrouter", account: "api-key")
		backend.seed("vault-pass", service: "dev.toby.sync", account: "vault-passphrase")
		let vault = TobyKeychain(service: "app.toby", backend: backend)

		#expect(vault.value("mail.imapHost") == "imap.example.com")
		#expect(vault.value("openrouter.apiKey") == "sk-or-1")
		#expect(vault.value("sync.passphrase") == "vault-pass")
		#expect(vault.value("mail.imapPassword") == nil, "never prompts for items another build created")
		#expect(vault.skippedLegacyKeys == ["mail.imapPassword"])
		let stored = try #require(backend.stored(service: "app.toby", account: "secrets"))
		#expect(try JSONDecoder().decode([String: String].self, from: stored)["mail.imapHost"] == "imap.example.com")
	}

	@Test func migrationRunsOnceThenReadsTheVault() throws {
		let backend = MemoryKeychain()
		backend.seed("old", service: "app.toby.openrouter", account: "api-key")
		let first = TobyKeychain(service: "app.toby", backend: backend)
		#expect(first.value("openrouter.apiKey") == "old")
		backend.seed("changed-legacy", service: "app.toby.openrouter", account: "api-key")
		let second = TobyKeychain(service: "app.toby", backend: backend)
		#expect(second.value("openrouter.apiKey") == "old", "legacy items are not re-read once the vault exists")
	}

	@Test func setAndRemoveUpdateTheSingleItem() throws {
		let backend = MemoryKeychain()
		let vault = TobyKeychain(service: "app.toby", backend: backend)
		try vault.set("a", for: "slack.botToken")
		try vault.set("b", for: "mail.imapHost")
		try vault.set(nil, for: "slack.botToken")
		#expect(backend.accounts(service: "app.toby") == ["secrets"])
		let reopened = TobyKeychain(service: "app.toby", backend: backend)
		#expect(reopened.value("mail.imapHost") == "b")
		#expect(reopened.value("slack.botToken") == nil)
	}

	@Test func devBuildsUseTheirOwnItem() {
		#expect(TobyKeychain.scopedService("app.toby", bundleID: "dev.karim.toby.app") == "app.toby")
		#expect(TobyKeychain.scopedService("app.toby", bundleID: "dev.karim.toby.app.dev") == "app.toby.dev")
		#expect(TobyKeychain.shared.service == "app.toby.tests", "tests never touch the real Keychain")
	}
}
