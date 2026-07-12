import { type Tool, tool } from "ai";
import { z } from "zod";
import type { Persona } from "../../config/index";
import { readConfig, readCredentials } from "../../config/index";
import { getCurrentDateTimeInfo } from "../current-datetime";
import { type Geocoder, createDefaultGeocoder } from "./geocode";
import { type TemperatureUnit, fetchOpenMeteoWeather } from "./open-meteo";

/**
 * Returns true when the weather tool is enabled in Settings.
 * No API key is required (Open-Meteo free tier).
 */
export function isWeatherAvailable(_persona?: Persona | null): boolean {
	const config = readConfig();
	return config.weather?.enabled === true;
}

interface WeatherToolContext {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly appliedActions: string[];
	/** Override geocoder (tests). */
	readonly geocoder?: Geocoder;
	/** Override fetch (tests). */
	readonly fetchImpl?: typeof fetch;
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
	if (!dateRegex.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Local calendar date as YYYY-MM-DD for the machine timezone. */
function defaultDateToday(now = new Date()): string {
	const info = getCurrentDateTimeInfo(now);
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: info.timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const year = parts.find((p) => p.type === "year")?.value;
	const month = parts.find((p) => p.type === "month")?.value;
	const day = parts.find((p) => p.type === "day")?.value;
	if (year && month && day) {
		return `${year}-${month}-${day}`;
	}
	return now.toISOString().slice(0, 10);
}

function resolveTemperatureUnit(inputUnit?: TemperatureUnit): TemperatureUnit {
	if (inputUnit === "celsius" || inputUnit === "fahrenheit") {
		return inputUnit;
	}
	const config = readConfig();
	return config.weather?.temperatureUnit === "fahrenheit"
		? "fahrenheit"
		: "celsius";
}

/**
 * Build the `getWeather` global tool. Returns an empty record when weather
 * is disabled in Settings.
 */
export function createWeatherGlobalTools(
	ctx: WeatherToolContext,
): Record<string, Tool> {
	if (!isWeatherAvailable(ctx.persona)) return {};

	const geocoder = ctx.geocoder ?? createDefaultGeocoder(ctx.fetchImpl);
	const fetchImpl = ctx.fetchImpl ?? fetch;

	return {
		getWeather: tool({
			description:
				"Get structured weather information (forecast and optional current conditions) for a location and date. Use for weather, forecast, temperature, precipitation, or climate questions. Accepts a place name (geocoded) or latitude/longitude. Worldwide coverage via Open-Meteo. Prefer this over webSearch for weather forecasts.",
			inputSchema: z.object({
				location: z
					.string()
					.optional()
					.describe(
						"Human-readable place name (city, region, postal code, address). Geocoded when latitude/longitude are not provided.",
					),
				latitude: z
					.number()
					.min(-90)
					.max(90)
					.optional()
					.describe(
						"WGS84 latitude. Provide with longitude to skip geocoding.",
					),
				longitude: z
					.number()
					.min(-180)
					.max(180)
					.optional()
					.describe(
						"WGS84 longitude. Provide with latitude to skip geocoding.",
					),
				date: z
					.string()
					.optional()
					.describe(
						"ISO date YYYY-MM-DD for the forecast day. Defaults to today in the local timezone.",
					),
				detail: z
					.enum(["daily", "hourly"])
					.optional()
					.describe(
						"daily (default): one-day summary. hourly: hour-by-hour for that date.",
					),
				temperatureUnit: z
					.enum(["celsius", "fahrenheit"])
					.optional()
					.describe(
						"Temperature unit. Defaults to the Settings → Weather unit preference.",
					),
			}),
			execute: async (input) => {
				const date = input.date?.trim() || defaultDateToday();
				if (!isValidIsoDate(date)) {
					return {
						ok: false,
						error: `Invalid date "${input.date}". Use YYYY-MM-DD.`,
						code: "no_data" as const,
					};
				}

				const detail = input.detail ?? "daily";
				const temperatureUnit = resolveTemperatureUnit(input.temperatureUnit);
				const config = readConfig();
				const locationQuery =
					input.location?.trim() ||
					config.weather?.defaultLocation?.trim() ||
					undefined;

				if (ctx.dryRun) {
					return {
						dryRun: true,
						location: locationQuery,
						latitude: input.latitude,
						longitude: input.longitude,
						date,
						detail,
						temperatureUnit,
					};
				}

				const hasCoords =
					typeof input.latitude === "number" &&
					typeof input.longitude === "number" &&
					Number.isFinite(input.latitude) &&
					Number.isFinite(input.longitude);

				let latitude: number;
				let longitude: number;
				let displayName: string | undefined;
				let query: string | undefined = locationQuery;

				if (hasCoords) {
					latitude = input.latitude as number;
					longitude = input.longitude as number;
					displayName = locationQuery;
				} else if (locationQuery) {
					try {
						const geo = await geocoder.geocode(locationQuery);
						if (!geo) {
							return {
								ok: false,
								error: `Could not find a location for "${locationQuery}". Try a more specific place name or provide latitude and longitude.`,
								code: "geocode_failed" as const,
							};
						}
						latitude = geo.latitude;
						longitude = geo.longitude;
						displayName = geo.displayName;
						query = locationQuery;
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						return {
							ok: false,
							error: message,
							code: "geocode_failed" as const,
						};
					}
				} else {
					return {
						ok: false,
						error:
							"Provide a location name, latitude/longitude, or set a default location in Settings → Weather.",
						code: "missing_location" as const,
					};
				}

				const creds = readCredentials();
				const apiKey = creds.weather?.apiKey?.trim() || undefined;
				const today = defaultDateToday();
				const includeCurrent = date === today;

				const weather = await fetchOpenMeteoWeather({
					latitude,
					longitude,
					date,
					detail,
					temperatureUnit,
					apiKey,
					includeCurrent,
					fetchImpl,
				});

				if (!weather.ok) {
					return weather;
				}

				return {
					...weather,
					location: {
						...weather.location,
						...(query ? { query } : {}),
						...(displayName ? { displayName } : {}),
					},
				};
			},
		}),
	};
}
