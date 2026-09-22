import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
	discoverEmailSettings,
	parseIspdbConfig,
} from "../../plugin-email/src/discover";

const FASTMAIL_XML = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="fastmail.com">
    <domain>example.test</domain>
    <displayName>Example Mail</displayName>
    <incomingServer type="imap">
      <hostname>imap.example.test</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.test</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILLOCALPART%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

describe("email discover", () => {
	it("resolves Gmail from the preset catalog", async () => {
		const result = await discoverEmailSettings("Ada@Gmail.com", {
			fetchIspdb: async () => {
				throw new Error("preset should not call ISPDB");
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toBe("preset");
		expect(result.providerName).toBe("Gmail");
		expect(result.domain).toBe("gmail.com");
		expect(result.appPasswordRequired).toBe(true);
		expect(result.settings.imapHost).toBe("imap.gmail.com");
		expect(result.settings.imapPort).toBe("993");
		expect(result.settings.imapSecure).toBe("true");
		expect(result.settings.smtpHost).toBe("smtp.gmail.com");
		expect(result.settings.imapUsername).toBe("Ada@Gmail.com");
		expect(result.settings.fromAddress).toBe("Ada@Gmail.com");
	});

	it("parses Mozilla ISPDB XML for an unknown domain", async () => {
		const result = await discoverEmailSettings("user@example.test", {
			fetchIspdb: async (domain) => {
				expect(domain).toBe("example.test");
				return FASTMAIL_XML;
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toBe("ispdb");
		expect(result.providerName).toBe("Example Mail");
		expect(result.settings.imapHost).toBe("imap.example.test");
		expect(result.settings.imapSecure).toBe("true");
		expect(result.settings.smtpHost).toBe("smtp.example.test");
		expect(result.settings.smtpPort).toBe("587");
		expect(result.settings.smtpSecure).toBe("false");
		expect(result.settings.smtpUsername).toBe("user");
	});

	it("returns source none when lookup finds nothing", async () => {
		const result = await discoverEmailSettings("user@example.test", {
			fetchIspdb: async () => null,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toBe("none");
		expect(result.settings.imapHost).toBe("");
		expect(result.settings.imapUsername).toBe("user@example.test");
		expect(result.settings.fromAddress).toBe("user@example.test");
	});

	it("rejects an invalid email address", async () => {
		const result = await discoverEmailSettings("not-an-email");
		expect(result).toEqual({
			ok: false,
			error: "Enter a valid email address, such as name@example.com.",
			code: "invalid_input",
		});
	});

	it("answers the discover subcommand for a known provider", () => {
		const entry = path.resolve(
			import.meta.dirname,
			"../../plugin-email/src/index.ts",
		);
		const result = spawnSync("bun", [entry, "discover"], {
			input: JSON.stringify({ email: "ada@icloud.com" }),
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		const body = JSON.parse(result.stdout) as {
			ok: boolean;
			source: string;
			providerName: string;
			settings: { imapHost: string };
		};
		expect(body.ok).toBe(true);
		expect(body.source).toBe("preset");
		expect(body.providerName).toBe("iCloud");
		expect(body.settings.imapHost).toBe("imap.mail.me.com");
	});

	it("ignores ISPDB documents that have no IMAP server", () => {
		expect(
			parseIspdbConfig(
				'<clientConfig><outgoingServer type="smtp"><hostname>smtp.example.test</hostname></outgoingServer></clientConfig>',
				"user@example.test",
			),
		).toBeNull();
	});
});
