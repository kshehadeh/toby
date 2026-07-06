import { describe, expect, it } from "bun:test";
import {
	buildImapConnectionOptions,
	normalizeConfig,
	parseEmailConfig,
	sanitizeImapConnectionOptions,
} from "../../plugin-email/src/client";

describe("email plugin IMAP client options", () => {
	const baseConfig = {
		imapHost: "imap.example.com",
		imapUsername: "user@example.com",
		imapPassword: "secret",
	};

	it("uses direct TLS for the default secure IMAP port", () => {
		const options = buildImapConnectionOptions({
			...baseConfig,
			imapPort: "993",
			imapSecure: "true",
		});

		expect(options.host).toBe("imap.example.com");
		expect(options.port).toBe(993);
		expect(options.secure).toBe(true);
		expect(options.doSTARTTLS).toBeUndefined();
		expect(options.auth).toEqual({
			user: "user@example.com",
			pass: "secret",
		});
		expect(options.connectionTimeout).toBeGreaterThan(0);
		expect(options.greetingTimeout).toBeGreaterThan(0);
		expect(options.socketTimeout).toBeGreaterThan(0);
	});

	it("requires STARTTLS for port 143 when IMAP TLS is enabled", () => {
		const options = buildImapConnectionOptions({
			...baseConfig,
			imapPort: "143",
			imapSecure: "true",
		});

		expect(options.port).toBe(143);
		expect(options.secure).toBe(false);
		expect(options.doSTARTTLS).toBe(true);
	});

	it("disables STARTTLS when IMAP TLS is disabled", () => {
		const options = buildImapConnectionOptions({
			...baseConfig,
			imapPort: "143",
			imapSecure: "false",
		});

		expect(options.secure).toBe(false);
		expect(options.doSTARTTLS).toBe(false);
	});

	it("normalizes string config values consistently", () => {
		const parsed = parseEmailConfig({
			imapHost: " imap.example.com ",
			imapPort: "not-a-port",
			imapSecure: "yes",
			imapUsername: " user@example.com ",
			imapPassword: " secret ",
			smtpSecure: "0",
		});

		expect(parsed.imapHost).toBe("imap.example.com");
		expect(parsed.imapPort).toBe(993);
		expect(parsed.imapSecure).toBe(true);
		expect(parsed.imapUsername).toBe("user@example.com");
		expect(parsed.imapPassword).toBe("secret");
		expect(parsed.smtpSecure).toBe(false);

		const normalized = normalizeConfig(parsed);
		expect(normalized.imapPort).toBe("993");
		expect(normalized.imapSecure).toBe("true");
		expect(normalized.smtpSecure).toBe("false");
	});

	it("sanitizes IMAP connection settings for logs", () => {
		const options = buildImapConnectionOptions({
			...baseConfig,
			imapPort: "993",
			imapSecure: "true",
		});

		const sanitized = sanitizeImapConnectionOptions(options);
		expect(sanitized).toMatchObject({
			host: "imap.example.com",
			port: 993,
			secure: true,
			doSTARTTLS: null,
			username: "user@example.com",
			passwordConfigured: true,
		});
		expect(JSON.stringify(sanitized)).not.toContain("secret");
		expect(sanitized).not.toHaveProperty("auth");
	});
});
