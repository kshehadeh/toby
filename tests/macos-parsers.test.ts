import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	extractBatterySnippet,
	parseAirportScanStdout,
	parseAudioInputDeviceNames,
	parseAudioOutputDeviceNames,
	parseSpAirPortNearbyNetworks,
	parseWifiDeviceFromNetworkSetupList,
} from "../src/integrations/macos/parsers";

const testsDir = fileURLToPath(new URL(".", import.meta.url));
describe("macos parsers", () => {
	it("parseWifiDeviceFromNetworkSetupList finds Wi‑Fi Device line", async () => {
		const fixturesDir = path.join(testsDir, "fixtures", "macos");
		const raw = await fs.readFile(
			path.join(fixturesDir, "networksetup-listallhardwareports-sample.txt"),
			"utf8",
		);
		expect(parseWifiDeviceFromNetworkSetupList(raw)).toBe("en0");
	});

	it("parseAudioOutputDeviceNames skips mics and aggregate blocks", async () => {
		const fixturesDir = path.join(testsDir, "fixtures", "macos");
		const raw = await fs.readFile(
			path.join(fixturesDir, "system_profiler-spaudio-sample.txt"),
			"utf8",
		);
		expect(parseAudioOutputDeviceNames(raw)).toEqual([
			"Built-in Speakers",
			"LG UltraFine",
		]);
	});

	it("parseAudioInputDeviceNames includes input devices", async () => {
		const fixturesDir = path.join(testsDir, "fixtures", "macos");
		const raw = await fs.readFile(
			path.join(fixturesDir, "system_profiler-spaudio-sample.txt"),
			"utf8",
		);
		expect(parseAudioInputDeviceNames(raw)).toEqual([
			"USB Microphone (Office)",
		]);
	});

	it("extractBatterySnippet truncates long blobs", () => {
		const long = `${"x".repeat(6000)}\n tail`;
		const out = extractBatterySnippet(long, 100);
		expect(out.endsWith("\n… _(truncated)_")).toBe(true);
		expect(out.length).toBeLessThan(long.length);
	});

	it("parseAirportScanStdout parses BSSID‑anchored rows", async () => {
		const fixturesDir = path.join(testsDir, "fixtures", "macos");
		const raw = await fs.readFile(
			path.join(fixturesDir, "airport-scan-sample.txt"),
			"utf8",
		);
		expect(parseAirportScanStdout(raw)).toEqual([
			{ ssid: "MyHomeWi-Fi", bssid: "aa:bb:cc:01:02:03", rssiDbm: -71 },
			{
				ssid: "CoffeeGuests",
				bssid: "82:cf:bf:71:92:ea",
				rssiDbm: -85,
			},
			{
				ssid: "(hidden / unknown)",
				bssid: "dd:01:aa:bc:99:aa",
				rssiDbm: -92,
			},
		]);
	});

	it("parseSpAirPortNearbyNetworks reads Other Local Wi‑Fi Networks entries", async () => {
		const fixturesDir = path.join(testsDir, "fixtures", "macos");
		const raw = await fs.readFile(
			path.join(fixturesDir, "system_profiler-spairport-sample.txt"),
			"utf8",
		);
		expect(parseSpAirPortNearbyNetworks(raw)).toEqual([
			{ ssid: "Bravo", rssiDbm: -65 },
			{ ssid: "Guest-Net", rssiDbm: -72 },
		]);
	});
});
