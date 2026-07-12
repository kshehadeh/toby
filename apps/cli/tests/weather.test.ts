import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultGeocoder } from "@toby/core/ai/weather/geocode";
import {
	OPEN_METEO_CUSTOMER_BASE,
	OPEN_METEO_FREE_BASE,
	fetchOpenMeteoWeather,
	resolveOpenMeteoBase,
} from "@toby/core/ai/weather/open-meteo";
import {
	createWeatherGlobalTools,
	isWeatherAvailable,
} from "@toby/core/ai/weather/weather-global-tools";
import { wmoCodeToLabel } from "@toby/core/ai/weather/wmo-codes";
import {
	clearCredentialsCache,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	seedConfigureValues,
} from "@toby/core/configure/persistence";

const PERSONA = {
	name: "Test",
	instructions: "test",
	promptMode: "add" as const,
	ai: { provider: "openai", model: "gpt-4.1-mini" },
};

let tempDir: string;
let previousTobyDir: string | undefined;

function withTempTobyDir(): void {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-weather-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	clearCredentialsCache();
}

function restoreTempTobyDir(): void {
	clearCredentialsCache();
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	if (tempDir && fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

describe("wmoCodeToLabel", () => {
	it("maps known codes", () => {
		expect(wmoCodeToLabel(0)).toBe("Clear sky");
		expect(wmoCodeToLabel(61)).toBe("Slight rain");
		expect(wmoCodeToLabel(95)).toBe("Thunderstorm");
	});

	it("handles unknown codes", () => {
		expect(wmoCodeToLabel(12345)).toContain("12345");
		expect(wmoCodeToLabel(null)).toBe("Unknown");
	});
});

describe("resolveOpenMeteoBase", () => {
	it("uses free host without API key", () => {
		expect(resolveOpenMeteoBase()).toBe(OPEN_METEO_FREE_BASE);
		expect(resolveOpenMeteoBase("")).toBe(OPEN_METEO_FREE_BASE);
		expect(resolveOpenMeteoBase("   ")).toBe(OPEN_METEO_FREE_BASE);
	});

	it("uses customer host when API key is set", () => {
		expect(resolveOpenMeteoBase("secret-key")).toBe(OPEN_METEO_CUSTOMER_BASE);
	});
});

describe("isWeatherAvailable", () => {
	beforeEach(() => {
		withTempTobyDir();
	});

	afterEach(() => {
		restoreTempTobyDir();
	});

	it("returns false when weather is not configured", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		expect(isWeatherAvailable()).toBe(false);
	});

	it("returns false when disabled", () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: false },
		});
		expect(isWeatherAvailable()).toBe(false);
	});

	it("returns true when enabled (no API key required)", () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: true },
		});
		writeCredentials({});
		expect(isWeatherAvailable()).toBe(true);
	});
});

describe("createWeatherGlobalTools", () => {
	beforeEach(() => {
		withTempTobyDir();
	});

	afterEach(() => {
		restoreTempTobyDir();
	});

	it("returns empty record when weather is unavailable", () => {
		writeConfig({ integrations: {}, personas: [] });
		const tools = createWeatherGlobalTools({
			persona: PERSONA,
			dryRun: false,
			appliedActions: [],
		});
		expect(Object.keys(tools)).toHaveLength(0);
	});

	it("returns getWeather tool when enabled", () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: true },
		});
		const tools = createWeatherGlobalTools({
			persona: PERSONA,
			dryRun: false,
			appliedActions: [],
		});
		expect(Object.keys(tools)).toEqual(["getWeather"]);
		expect(tools.getWeather).toBeDefined();
	});

	it("dryRun returns preview without network", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: true },
		});
		const tools = createWeatherGlobalTools({
			persona: PERSONA,
			dryRun: true,
			appliedActions: [],
		});
		const result = await tools.getWeather?.execute?.(
			{
				location: "Seattle",
				date: "2026-07-15",
				detail: "daily",
			},
			{ toolCallId: "t1", messages: [] } as never,
		);
		expect(result).toMatchObject({
			dryRun: true,
			location: "Seattle",
			date: "2026-07-15",
			detail: "daily",
		});
	});

	it("returns missing_location when no location configured", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: true },
		});
		const tools = createWeatherGlobalTools({
			persona: PERSONA,
			dryRun: false,
			appliedActions: [],
		});
		const result = (await tools.getWeather?.execute?.({}, {
			toolCallId: "t1",
			messages: [],
		} as never)) as { ok: boolean; code?: string };
		expect(result.ok).toBe(false);
		expect(result.code).toBe("missing_location");
	});

	it("geocodes location then fetches open-meteo", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: true, temperatureUnit: "celsius" },
		});

		const calls: string[] = [];
		const fetchImpl = (async (input: RequestInfo | URL) => {
			const url = String(input);
			calls.push(url);
			if (url.includes("nominatim")) {
				return new Response(
					JSON.stringify([
						{
							lat: "47.6062",
							lon: "-122.3321",
							display_name: "Seattle, Washington, USA",
						},
					]),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("open-meteo.com")) {
				return new Response(
					JSON.stringify({
						latitude: 47.6,
						longitude: -122.3,
						elevation: 50,
						timezone: "America/Los_Angeles",
						daily: {
							time: ["2026-07-15"],
							weather_code: [1],
							temperature_2m_max: [22.5],
							temperature_2m_min: [14.0],
							apparent_temperature_max: [21],
							apparent_temperature_min: [13],
							precipitation_sum: [0.2],
							precipitation_probability_max: [20],
							wind_speed_10m_max: [12],
							wind_direction_10m_dominant: [270],
							sunrise: ["2026-07-15T05:30"],
							sunset: ["2026-07-15T20:45"],
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		}) as typeof fetch;

		const tools = createWeatherGlobalTools({
			persona: PERSONA,
			dryRun: false,
			appliedActions: [],
			fetchImpl,
		});

		const result = (await tools.getWeather?.execute?.(
			{ location: "Seattle", date: "2026-07-15", detail: "daily" },
			{ toolCallId: "t1", messages: [] } as never,
		)) as {
			ok: boolean;
			source?: string;
			location?: { displayName?: string; latitude?: number };
			daily?: { temperatureMax?: number; weatherLabel?: string };
		};

		expect(result.ok).toBe(true);
		expect(result.source).toBe("Open-Meteo");
		expect(result.location?.displayName).toContain("Seattle");
		expect(result.location?.latitude).toBeCloseTo(47.6, 0);
		expect(result.daily?.temperatureMax).toBe(22.5);
		expect(result.daily?.weatherLabel).toBe("Mainly clear");
		expect(calls.some((u) => u.includes("nominatim"))).toBe(true);
		expect(calls.some((u) => u.includes(OPEN_METEO_FREE_BASE))).toBe(true);
	});

	it("uses customer API host when API key is configured", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: { enabled: true },
		});
		writeCredentials({ weather: { apiKey: "paid-key" } });

		const calls: string[] = [];
		const fetchImpl = (async (input: RequestInfo | URL) => {
			const url = String(input);
			calls.push(url);
			return new Response(
				JSON.stringify({
					latitude: 40.7,
					longitude: -74.0,
					timezone: "America/New_York",
					daily: {
						time: ["2026-07-15"],
						weather_code: [0],
						temperature_2m_max: [30],
						temperature_2m_min: [20],
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const tools = createWeatherGlobalTools({
			persona: PERSONA,
			dryRun: false,
			appliedActions: [],
			fetchImpl,
		});

		const result = (await tools.getWeather?.execute?.(
			{ latitude: 40.7, longitude: -74.0, date: "2026-07-15" },
			{ toolCallId: "t1", messages: [] } as never,
		)) as { ok: boolean };

		expect(result.ok).toBe(true);
		expect(calls[0]).toContain(OPEN_METEO_CUSTOMER_BASE);
		expect(calls[0]).toContain("apikey=paid-key");
		expect(calls.every((u) => !u.includes("nominatim"))).toBe(true);
	});
});

describe("createDefaultGeocoder", () => {
	it("parses nominatim response", async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify([
					{
						lat: "51.5074",
						lon: "-0.1278",
						display_name: "London, UK",
					},
				]),
				{ status: 200 },
			)) as typeof fetch;

		const geo = await createDefaultGeocoder(fetchImpl).geocode("London");
		expect(geo).toEqual({
			latitude: 51.5074,
			longitude: -0.1278,
			displayName: "London, UK",
			raw: {
				lat: "51.5074",
				lon: "-0.1278",
				display_name: "London, UK",
			},
		});
	});

	it("returns null for empty results", async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify([]), { status: 200 })) as typeof fetch;
		const geo = await createDefaultGeocoder(fetchImpl).geocode("xyzzy");
		expect(geo).toBeNull();
	});
});

describe("fetchOpenMeteoWeather", () => {
	it("maps hourly points for the requested date", async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					latitude: 52.52,
					longitude: 13.41,
					timezone: "Europe/Berlin",
					hourly: {
						time: ["2026-07-15T00:00", "2026-07-15T01:00", "2026-07-16T00:00"],
						temperature_2m: [10, 11, 12],
						weather_code: [0, 1, 2],
						relative_humidity_2m: [80, 81, 82],
						apparent_temperature: [9, 10, 11],
						precipitation_probability: [0, 5, 10],
						precipitation: [0, 0, 0],
						wind_speed_10m: [5, 6, 7],
						wind_direction_10m: [90, 100, 110],
						cloud_cover: [10, 20, 30],
					},
				}),
				{ status: 200 },
			)) as typeof fetch;

		const result = await fetchOpenMeteoWeather({
			latitude: 52.52,
			longitude: 13.41,
			date: "2026-07-15",
			detail: "hourly",
			temperatureUnit: "celsius",
			fetchImpl,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.hourly).toHaveLength(2);
		expect(result.hourly?.[0]?.temperature).toBe(10);
		expect(result.hourly?.[1]?.weatherLabel).toBe("Mainly clear");
	});
});

describe("weather configure persistence", () => {
	beforeEach(() => {
		withTempTobyDir();
	});

	afterEach(() => {
		restoreTempTobyDir();
	});

	it("seeds default weather values when unset", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		const values = seedConfigureValues();
		expect(values["weather.enabled"]).toBe("false");
		expect(values["weather.temperatureUnit"]).toBe("celsius");
		expect(values["weather.defaultLocation"]).toBe("");
	});

	it("reads weather config and api key", () => {
		writeConfig({
			integrations: {},
			personas: [],
			weather: {
				enabled: true,
				defaultLocation: "Berlin",
				temperatureUnit: "fahrenheit",
			},
		});
		writeCredentials({ weather: { apiKey: "om-key" } });
		const values = seedConfigureValues();
		expect(values["weather.enabled"]).toBe("true");
		expect(values["weather.defaultLocation"]).toBe("Berlin");
		expect(values["weather.temperatureUnit"]).toBe("fahrenheit");
		expect(values["weather.apiKey"]).toBe("om-key");
	});

	it("applyConfigureValuesPatch enables weather and saves defaults", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({
			"weather.enabled": "true",
			"weather.defaultLocation": "Tokyo",
			"weather.temperatureUnit": "celsius",
		});
		const config = readConfig();
		expect(config.weather?.enabled).toBe(true);
		expect(config.weather?.defaultLocation).toBe("Tokyo");
		expect(config.weather?.temperatureUnit).toBe("celsius");
	});

	it("applyConfigureValuesPatch saves weather API key to credentials", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({
			"weather.enabled": "true",
			"weather.apiKey": "customer-secret",
		});
		const creds = readCredentials();
		expect(creds.weather?.apiKey).toBe("customer-secret");
	});

	it("weather settings round-trip through seed after patch", () => {
		writeConfig({ integrations: {}, personas: [] });
		writeCredentials({});
		applyConfigureValuesPatch({
			"weather.enabled": "true",
			"weather.defaultLocation": "Paris",
			"weather.temperatureUnit": "fahrenheit",
			"weather.apiKey": "k1",
		});
		const values = seedConfigureValues();
		expect(values["weather.enabled"]).toBe("true");
		expect(values["weather.defaultLocation"]).toBe("Paris");
		expect(values["weather.temperatureUnit"]).toBe("fahrenheit");
		expect(values["weather.apiKey"]).toBe("k1");
	});
});
