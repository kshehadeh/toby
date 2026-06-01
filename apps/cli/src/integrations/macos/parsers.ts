/** Parse `/usr/sbin/networksetup -listallhardwareports` stdout for Wi-Fi device (e.g. en0). */
export function parseWifiDeviceFromNetworkSetupList(
	stdout: string,
): string | null {
	const lines = stdout.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trimEnd() ?? "";
		if (/^Hardware Port:\s*Wi-Fi/i.test(line)) {
			for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
				const dl = lines[j] ?? "";
				const m = dl.match(/^Device:\s*(en\d+)/i);
				if (m?.[1]) {
					return m[1]?.toLowerCase() ?? null;
				}
			}
		}
	}
	return null;
}

function parseAudioDeviceNames(
	systemProfilerStdout: string,
	channelLabel: "input channels" | "output channels",
): string[] {
	const normalized = systemProfilerStdout.replace(/\r/g, "");
	const paragraphs = normalized.split(/\n\s*\n/);
	const names: string[] = [];
	const seen = new Set<string>();

	for (const paragraph of paragraphs) {
		const plines = paragraph.split(/\n/).filter((x) => x.trim().length > 0);
		if (plines.length < 2) continue;
		const head = plines[0]?.trim() ?? "";
		if (!head.endsWith(":")) continue;
		const title = head.slice(0, -1).trim();
		if (!title) continue;
		const bodyLower = paragraph.toLowerCase();
		if (
			bodyLower.includes(channelLabel) &&
			!title.toLowerCase().includes("aggregate")
		) {
			if (!seen.has(title)) {
				seen.add(title);
				names.push(title);
			}
		}
	}

	return names;
}

/**
 * Rough parse of `system_profiler SPAudioDataType` plaintext: device blocks containing
 * "Output Channels".
 */
export function parseAudioOutputDeviceNames(
	systemProfilerStdout: string,
): string[] {
	return parseAudioDeviceNames(systemProfilerStdout, "output channels");
}

/**
 * Rough parse of `system_profiler SPAudioDataType` plaintext: device blocks containing
 * "Input Channels".
 */
export function parseAudioInputDeviceNames(
	systemProfilerStdout: string,
): string[] {
	return parseAudioDeviceNames(systemProfilerStdout, "input channels");
}

/** One row parsed from Apple's `airport -s` (or `{device} scan`) table-ish output. */
export interface ParsedAirportWifiRow {
	readonly ssid: string;
	readonly bssid?: string;
	readonly rssiDbm?: number;
}

/**
 * Parse `airport -s` / `airport <device> scan` stdout into rows.
 * SSID names may appear truncated depending on Apple's column formatting; callers can use raw stdout if needed.
 */
export function parseAirportScanStdout(stdout: string): ParsedAirportWifiRow[] {
	const lines = stdout.split(/\r?\n/).map((l) => l.replace(/\u00a0/g, " "));
	let dataStart = 0;
	for (let i = 0; i < lines.length; i++) {
		const u = lines[i] ?? "";
		if (/SSID/i.test(u) && /BSSID/i.test(u)) {
			dataStart = i + 1;
			break;
		}
	}
	const bssidRe = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i;
	const rows: ParsedAirportWifiRow[] = [];

	for (let i = dataStart; i < lines.length; i++) {
		const line = lines[i]?.trimEnd() ?? "";
		if (!line.trim()) continue;
		const bm = line.match(bssidRe);
		if (!bm || bm.index === undefined) continue;
		const bssid = bm[0].toLowerCase();
		let ssidPrefix = line
			.slice(0, bm.index)
			.trimEnd()
			.replace(/^[\s*-]+/, "")
			.trim();

		const suffixParts = line
			.slice(bm.index + bssid.length)
			.trim()
			.split(/\s+/);

		let rssiDbm: number | undefined;
		for (const p of suffixParts) {
			const n = Number.parseInt(p, 10);
			if (
				!Number.isNaN(n) &&
				n <= 0 &&
				n >= -120 /* ignore channel numbers picked up as RSSI mistakenly */
			) {
				rssiDbm = n;
				break;
			}
		}

		if (!ssidPrefix) {
			ssidPrefix = "(hidden / unknown)";
		}
		const row: ParsedAirportWifiRow = {
			ssid: ssidPrefix,
			bssid,
			...(typeof rssiDbm === "number" ? { rssiDbm } : {}),
		};
		rows.push(row);
	}

	return rows;
}

const WLAN_DETAIL_KEY_LABEL = new Set(
	[
		"phy mode",
		"channel",
		"country code",
		"network type",
		"security",
		"signal / noise",
		"transmit rate",
		"mcs index",
		"bssid",
		"firmware version",
		"card type",
		"locale",
		"wake on wireless",
		"airdrop",
		"supported phy modes",
		"supported channels",
	].map((s) => s.toLowerCase()),
);

function profilerLeadingWs(line: string): number {
	const m = /^([\t ]*)/.exec(line);
	const raw = m?.[1] ?? "";
	let n = 0;
	for (const ch of raw) {
		if (ch === " ") {
			n += 1;
		} else if (ch === "\t") {
			n += 8;
		}
	}
	return n;
}

function extractProfilerLineLabelAndRest(line: string): {
	readonly indent: number;
	readonly label: string;
	readonly rest: string;
} | null {
	const m = /^(\s*)([^:]+:\s*)([\s\S]*)$/.exec(line);
	if (!m || m.index === undefined) return null;
	const label = (m[2] ?? "").replace(/:\s*$/, "").trim();
	const rest = (m[3] ?? "").trim();
	return {
		indent: profilerLeadingWs(line),
		label,
		rest,
	};
}

function isWLANDetailKeyLabel(label: string): boolean {
	const t = label.trim().toLowerCase();
	return WLAN_DETAIL_KEY_LABEL.has(t);
}

/**
 * Nearby SSIDs listed under **Other Local Wi-Fi Networks** in
 * `system_profiler SPAirPortDataType` plaintext (common after Apple deprecated `airport` on Sonoma 14.4+).
 */
export function parseSpAirPortNearbyNetworks(
	systemProfilerStdout: string,
): ParsedAirportWifiRow[] {
	const lines = systemProfilerStdout.split(/\r?\n/);
	const out: ParsedAirportWifiRow[] = [];

	for (let hi = 0; hi < lines.length; hi++) {
		const hline = lines[hi]?.trimEnd() ?? "";
		if (
			!/^[\t ]+Other Local Wi-Fi Networks\s*:\s*$/i.test(hline) &&
			!/^\s*Other Local Wi-Fi Networks\s*:\s*$/i.test(hline)
		) {
			continue;
		}
		const hdrIndent = profilerLeadingWs(hline);

		let k = hi + 1;
		while (k < lines.length) {
			const lineRaw = lines[k] ?? "";
			if (!lineRaw.trim()) {
				k += 1;
				continue;
			}
			const ind = profilerLeadingWs(lineRaw);
			if (ind <= hdrIndent) break;

			const parsed = extractProfilerLineLabelAndRest(lineRaw);
			if (
				!parsed ||
				parsed.rest.length > 0 ||
				isWLANDetailKeyLabel(parsed.label)
			) {
				k += 1;
				continue;
			}

			const ssidIndent = parsed.indent;
			const ssidHeading = parsed.label.trim();
			if (!ssidHeading) {
				k += 1;
				continue;
			}

			let peek = k + 1;
			while (peek < lines.length && !(lines[peek] ?? "").trim()) peek += 1;
			const nextLine = lines[peek];
			const nextIndent = nextLine ? profilerLeadingWs(nextLine) : -1;
			if (nextIndent <= ssidIndent) {
				k += 1;
				continue;
			}

			let j = peek;
			const block: string[] = [];
			while (j < lines.length) {
				const ln = lines[j] ?? "";
				if (!ln.trim()) {
					j += 1;
					continue;
				}
				if (profilerLeadingWs(ln) <= hdrIndent) break;
				const p2 = extractProfilerLineLabelAndRest(ln);
				if (
					p2 &&
					p2.rest.length === 0 &&
					p2.indent === ssidIndent &&
					!isWLANDetailKeyLabel(p2.label)
				) {
					break;
				}
				block.push(ln);
				j += 1;
			}

			const chunk = block.join("\n");
			const sigMatch = /\bSignal\s*\/\s*Noise:\s*(-?\d+)\s*dBm/i.exec(chunk);
			const rssiRaw = sigMatch?.[1];
			const rssiDbm =
				rssiRaw !== undefined ? Number.parseInt(rssiRaw, 10) : Number.NaN;
			const bssidMatch = /\bBSSID:\s*((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\b/i.exec(
				chunk,
			);
			const bssid =
				bssidMatch?.[1] !== undefined
					? String(bssidMatch[1]).toLowerCase()
					: undefined;

			out.push({
				ssid: ssidHeading,
				...(!Number.isNaN(rssiDbm) ? { rssiDbm } : {}),
				...(bssid !== undefined ? { bssid } : {}),
			});
			k = j;
		}
	}

	return out;
}

/** Extract a few readable lines from `system_profiler SPBatteryDataType`. */
export function extractBatterySnippet(
	spBatteryStdout: string,
	maxChars = 4000,
): string {
	const t = spBatteryStdout.trim();
	if (t.length <= maxChars) return t;
	return `${t.slice(0, maxChars)}\n… _(truncated)_`;
}
