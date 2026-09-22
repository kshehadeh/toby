/**
 * Discover IMAP/SMTP settings from an email address.
 * Known providers resolve locally. Other domains fall back to Mozilla ISPDB.
 */

const ISPDB_ORIGIN = "https://autoconfig.thunderbird.net";
const ISPDB_TIMEOUT_MS = 8_000;

export type EmailDiscoverSource = "preset" | "ispdb" | "none";

export interface EmailServerSettings {
	imapHost: string;
	imapPort: string;
	imapSecure: string;
	imapUsername: string;
	smtpHost: string;
	smtpPort: string;
	smtpSecure: string;
	smtpUsername: string;
	fromAddress: string;
}

export interface EmailDiscoverSuccess {
	ok: true;
	email: string;
	domain: string;
	source: EmailDiscoverSource;
	providerName?: string;
	appPasswordRequired?: boolean;
	documentationUrl?: string;
	settings: EmailServerSettings;
}

export interface EmailDiscoverFailure {
	ok: false;
	error: string;
	code: "invalid_input";
}

export type EmailDiscoverResult = EmailDiscoverSuccess | EmailDiscoverFailure;

interface ProviderPreset {
	providerName: string;
	domains: readonly string[];
	imapHost: string;
	imapPort: string;
	imapSecure: string;
	smtpHost: string;
	smtpPort: string;
	smtpSecure: string;
	appPasswordRequired: boolean;
	documentationUrl: string;
}

const PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{
		providerName: "Gmail",
		domains: ["gmail.com", "googlemail.com"],
		imapHost: "imap.gmail.com",
		imapPort: "993",
		imapSecure: "true",
		smtpHost: "smtp.gmail.com",
		smtpPort: "465",
		smtpSecure: "true",
		appPasswordRequired: true,
		documentationUrl:
			"https://support.google.com/mail/answer/78892?hl=en&sjid=15691795537353814651-NA",
	},
	{
		providerName: "Outlook",
		domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
		imapHost: "outlook.office365.com",
		imapPort: "993",
		imapSecure: "true",
		smtpHost: "smtp.office365.com",
		smtpPort: "587",
		smtpSecure: "false",
		appPasswordRequired: true,
		documentationUrl:
			"https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com",
	},
	{
		providerName: "iCloud",
		domains: ["icloud.com", "me.com", "mac.com"],
		imapHost: "imap.mail.me.com",
		imapPort: "993",
		imapSecure: "true",
		smtpHost: "smtp.mail.me.com",
		smtpPort: "587",
		smtpSecure: "false",
		appPasswordRequired: true,
		documentationUrl: "https://support.apple.com/en-us/102525",
	},
	{
		providerName: "Yahoo",
		domains: ["yahoo.com", "ymail.com", "rocketmail.com"],
		imapHost: "imap.mail.yahoo.com",
		imapPort: "993",
		imapSecure: "true",
		smtpHost: "smtp.mail.yahoo.com",
		smtpPort: "465",
		smtpSecure: "true",
		appPasswordRequired: true,
		documentationUrl: "https://help.yahoo.com/kb/SLN4075.html",
	},
	{
		providerName: "Fastmail",
		domains: ["fastmail.com", "fastmail.fm"],
		imapHost: "imap.fastmail.com",
		imapPort: "993",
		imapSecure: "true",
		smtpHost: "smtp.fastmail.com",
		smtpPort: "465",
		smtpSecure: "true",
		appPasswordRequired: true,
		documentationUrl:
			"https://www.fastmail.help/hc/en-us/articles/1500000279921-IMAP-POP-and-SMTP",
	},
	{
		providerName: "Proton Mail",
		domains: ["proton.me", "protonmail.com", "pm.me"],
		imapHost: "127.0.0.1",
		imapPort: "1143",
		imapSecure: "false",
		smtpHost: "127.0.0.1",
		smtpPort: "1025",
		smtpSecure: "false",
		appPasswordRequired: true,
		documentationUrl: "https://proton.me/support/imap-smtp-and-pop3-setup",
	},
];

const PRESET_BY_DOMAIN = new Map<string, ProviderPreset>(
	PROVIDER_PRESETS.flatMap((preset) =>
		preset.domains.map((domain) => [domain, preset] as const),
	),
);

export type IspdbFetch = (domain: string) => Promise<string | null>;

export async function discoverEmailSettings(
	rawEmail: string,
	options: { fetchIspdb?: IspdbFetch } = {},
): Promise<EmailDiscoverResult> {
	const parsed = parseEmailAddress(rawEmail);
	if (!parsed) {
		return {
			ok: false,
			error: "Enter a valid email address, such as name@example.com.",
			code: "invalid_input",
		};
	}

	const preset = PRESET_BY_DOMAIN.get(parsed.domain);
	if (preset) {
		return {
			ok: true,
			email: parsed.email,
			domain: parsed.domain,
			source: "preset",
			providerName: preset.providerName,
			appPasswordRequired: preset.appPasswordRequired,
			documentationUrl: preset.documentationUrl,
			settings: settingsFromPreset(preset, parsed.email),
		};
	}

	const fetchIspdb = options.fetchIspdb ?? fetchMozillaIspdb;
	let xml: string | null = null;
	try {
		xml = await fetchIspdb(parsed.domain);
	} catch {
		xml = null;
	}
	const parsedXml = xml ? parseIspdbConfig(xml, parsed.email) : null;
	if (parsedXml) {
		return {
			ok: true,
			email: parsed.email,
			domain: parsed.domain,
			source: "ispdb",
			providerName: parsedXml.providerName,
			settings: parsedXml.settings,
		};
	}

	return {
		ok: true,
		email: parsed.email,
		domain: parsed.domain,
		source: "none",
		settings: emptySettings(parsed.email),
	};
}

export function parseIspdbConfig(
	xml: string,
	email: string,
): { providerName?: string; settings: EmailServerSettings } | null {
	const imap = firstServerBlock(xml, "incomingServer", "imap");
	if (!imap) return null;
	const smtp = firstServerBlock(xml, "outgoingServer", "smtp");
	const imapHost = textValue(imap, "hostname");
	if (!imapHost) return null;
	const smtpHost = smtp ? textValue(smtp, "hostname") : "";
	const providerName = textValue(xml, "displayName") || undefined;
	return {
		providerName,
		settings: {
			imapHost,
			imapPort: textValue(imap, "port") || "993",
			imapSecure: socketTypeIsDirectTls(textValue(imap, "socketType"))
				? "true"
				: "false",
			imapUsername: expandUsername(textValue(imap, "username"), email),
			smtpHost,
			smtpPort: smtp ? textValue(smtp, "port") || "587" : "",
			smtpSecure:
				smtp && socketTypeIsDirectTls(textValue(smtp, "socketType"))
					? "true"
					: "false",
			smtpUsername: smtp
				? expandUsername(textValue(smtp, "username"), email)
				: email,
			fromAddress: email,
		},
	};
}

export async function fetchMozillaIspdb(
	domain: string,
): Promise<string | null> {
	if (!isDnsDomain(domain) || domain.includes("/") || domain.includes("\\")) {
		return null;
	}
	const url = new URL(`/v1.1/${encodeURIComponent(domain)}`, ISPDB_ORIGIN);
	if (url.origin !== ISPDB_ORIGIN) return null;
	const response = await fetch(url, {
		redirect: "manual",
		signal: AbortSignal.timeout(ISPDB_TIMEOUT_MS),
	});
	if (response.status !== 200) return null;
	return response.text();
}

function settingsFromPreset(
	preset: ProviderPreset,
	email: string,
): EmailServerSettings {
	return {
		imapHost: preset.imapHost,
		imapPort: preset.imapPort,
		imapSecure: preset.imapSecure,
		imapUsername: email,
		smtpHost: preset.smtpHost,
		smtpPort: preset.smtpPort,
		smtpSecure: preset.smtpSecure,
		smtpUsername: email,
		fromAddress: email,
	};
}

function emptySettings(email: string): EmailServerSettings {
	return {
		imapHost: "",
		imapPort: "993",
		imapSecure: "true",
		imapUsername: email,
		smtpHost: "",
		smtpPort: "587",
		smtpSecure: "false",
		smtpUsername: email,
		fromAddress: email,
	};
}

function parseEmailAddress(
	raw: string,
): { email: string; domain: string } | null {
	const email = raw.trim();
	if (!email || /\s/.test(email)) return null;
	const at = email.lastIndexOf("@");
	if (at <= 0 || at !== email.indexOf("@")) return null;
	const domain = email.slice(at + 1).toLowerCase();
	if (!isDnsDomain(domain)) return null;
	return { email, domain };
}

function isDnsDomain(domain: string): boolean {
	if (domain.length > 253 || domain.includes("/") || domain.includes("\\")) {
		return false;
	}
	const labels = domain.split(".");
	if (labels.length < 2) return false;
	return labels.every(
		(label) =>
			label.length > 0 &&
			label.length <= 63 &&
			/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
	);
}

function firstServerBlock(
	xml: string,
	tag: "incomingServer" | "outgoingServer",
	type: string,
): string | null {
	const pattern = new RegExp(
		`<${tag}\\b[^>]*\\btype=["']${type}["'][^>]*>([\\s\\S]*?)</${tag}>`,
		"i",
	);
	return pattern.exec(xml)?.[1] ?? null;
}

function textValue(xml: string, tag: string): string {
	const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(
		xml,
	);
	return match?.[1]?.trim() ?? "";
}

function socketTypeIsDirectTls(socketType: string): boolean {
	const normalized = socketType.trim().toUpperCase();
	return normalized === "SSL" || normalized === "SSL/TLS";
}

function expandUsername(template: string, email: string): string {
	const local = email.slice(0, email.lastIndexOf("@"));
	const value = template
		.replaceAll("%EMAILADDRESS%", email)
		.replaceAll("%EMAILLOCALPART%", local)
		.trim();
	return value || email;
}
