import { getTobyVersion } from "../../version";
import { wmoCodeToLabel } from "./wmo-codes";

export const OPEN_METEO_FREE_BASE = "https://api.open-meteo.com";
export const OPEN_METEO_CUSTOMER_BASE = "https://customer-api.open-meteo.com";

const FORECAST_TIMEOUT_MS = 15_000;

export type TemperatureUnit = "celsius" | "fahrenheit";
export type WeatherDetail = "daily" | "hourly";

export interface OpenMeteoFetchParams {
	readonly latitude: number;
	readonly longitude: number;
	readonly date: string; // YYYY-MM-DD
	readonly detail: WeatherDetail;
	readonly temperatureUnit: TemperatureUnit;
	/** Optional Open-Meteo customer API key. */
	readonly apiKey?: string;
	/** When true, include current conditions (typically when date is today). */
	readonly includeCurrent?: boolean;
	readonly fetchImpl?: typeof fetch;
}

export interface WeatherUnits {
	readonly temperature: string;
	readonly windSpeed: string;
	readonly precipitation: string;
}

export interface DailyWeatherSummary {
	readonly date: string;
	readonly weatherCode?: number | null;
	readonly weatherLabel?: string;
	readonly temperatureMax?: number | null;
	readonly temperatureMin?: number | null;
	readonly apparentTemperatureMax?: number | null;
	readonly apparentTemperatureMin?: number | null;
	readonly precipitationSum?: number | null;
	readonly precipitationProbabilityMax?: number | null;
	readonly windSpeedMax?: number | null;
	readonly windDirectionDominant?: number | null;
	readonly sunrise?: string | null;
	readonly sunset?: string | null;
}

export interface HourlyWeatherPoint {
	readonly time: string;
	readonly temperature?: number | null;
	readonly relativeHumidity?: number | null;
	readonly apparentTemperature?: number | null;
	readonly precipitationProbability?: number | null;
	readonly precipitation?: number | null;
	readonly weatherCode?: number | null;
	readonly weatherLabel?: string;
	readonly windSpeed?: number | null;
	readonly windDirection?: number | null;
	readonly cloudCover?: number | null;
}

export interface CurrentWeather {
	readonly time?: string;
	readonly temperature?: number | null;
	readonly relativeHumidity?: number | null;
	readonly apparentTemperature?: number | null;
	readonly weatherCode?: number | null;
	readonly weatherLabel?: string;
	readonly windSpeed?: number | null;
	readonly windDirection?: number | null;
	readonly precipitation?: number | null;
	readonly cloudCover?: number | null;
	readonly isDay?: boolean | null;
}

export interface OpenMeteoWeatherResult {
	readonly ok: true;
	readonly source: "Open-Meteo";
	readonly attribution: string;
	readonly location: {
		readonly latitude: number;
		readonly longitude: number;
		readonly timezone?: string;
		readonly elevation?: number;
	};
	readonly date: string;
	readonly detail: WeatherDetail;
	readonly units: WeatherUnits;
	readonly daily?: DailyWeatherSummary;
	readonly hourly?: HourlyWeatherPoint[];
	readonly current?: CurrentWeather;
}

export interface OpenMeteoErrorResult {
	readonly ok: false;
	readonly error: string;
	readonly code?: "http_error" | "no_data" | "parse_error";
}

export type OpenMeteoResult = OpenMeteoWeatherResult | OpenMeteoErrorResult;

export function resolveOpenMeteoBase(apiKey?: string): string {
	return apiKey?.trim() ? OPEN_METEO_CUSTOMER_BASE : OPEN_METEO_FREE_BASE;
}

function weatherUserAgent(): string {
	return `Toby/${getTobyVersion()} (https://github.com/kshehadeh/toby)`;
}

function pickUnitLabels(temperatureUnit: TemperatureUnit): WeatherUnits {
	if (temperatureUnit === "fahrenheit") {
		return {
			temperature: "°F",
			windSpeed: "mph",
			precipitation: "inch",
		};
	}
	return {
		temperature: "°C",
		windSpeed: "km/h",
		precipitation: "mm",
	};
}

function atIndex<T>(arr: T[] | undefined, i: number): T | null | undefined {
	if (!arr) return undefined;
	return arr[i];
}

interface OpenMeteoJson {
	latitude?: number;
	longitude?: number;
	elevation?: number;
	timezone?: string;
	daily?: Record<string, Array<string | number | null>>;
	hourly?: Record<string, Array<string | number | null>>;
	current?: Record<string, string | number | boolean | null>;
	daily_units?: Record<string, string>;
	hourly_units?: Record<string, string>;
	current_units?: Record<string, string>;
	reason?: string;
	error?: boolean;
}

/**
 * Fetch forecast/current weather from Open-Meteo for a single calendar date.
 */
export async function fetchOpenMeteoWeather(
	params: OpenMeteoFetchParams,
): Promise<OpenMeteoResult> {
	const apiKey = params.apiKey?.trim() || undefined;
	const base = resolveOpenMeteoBase(apiKey);
	const fetchImpl = params.fetchImpl ?? fetch;

	const url = new URL(`${base}/v1/forecast`);
	url.searchParams.set("latitude", String(params.latitude));
	url.searchParams.set("longitude", String(params.longitude));
	url.searchParams.set("timezone", "auto");
	url.searchParams.set("temperature_unit", params.temperatureUnit);
	url.searchParams.set(
		"wind_speed_unit",
		params.temperatureUnit === "fahrenheit" ? "mph" : "kmh",
	);
	url.searchParams.set(
		"precipitation_unit",
		params.temperatureUnit === "fahrenheit" ? "inch" : "mm",
	);
	url.searchParams.set("start_date", params.date);
	url.searchParams.set("end_date", params.date);

	if (params.detail === "daily") {
		url.searchParams.set(
			"daily",
			[
				"weather_code",
				"temperature_2m_max",
				"temperature_2m_min",
				"apparent_temperature_max",
				"apparent_temperature_min",
				"precipitation_sum",
				"precipitation_probability_max",
				"wind_speed_10m_max",
				"wind_direction_10m_dominant",
				"sunrise",
				"sunset",
			].join(","),
		);
	} else {
		url.searchParams.set(
			"hourly",
			[
				"temperature_2m",
				"relative_humidity_2m",
				"apparent_temperature",
				"precipitation_probability",
				"precipitation",
				"weather_code",
				"wind_speed_10m",
				"wind_direction_10m",
				"cloud_cover",
			].join(","),
		);
	}

	if (params.includeCurrent) {
		url.searchParams.set(
			"current",
			[
				"temperature_2m",
				"relative_humidity_2m",
				"apparent_temperature",
				"precipitation",
				"weather_code",
				"cloud_cover",
				"wind_speed_10m",
				"wind_direction_10m",
				"is_day",
			].join(","),
		);
	}

	if (apiKey) {
		url.searchParams.set("apikey", apiKey);
	}

	try {
		const response = await fetchImpl(url.toString(), {
			headers: {
				"User-Agent": weatherUserAgent(),
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS),
		});

		if (!response.ok) {
			let detail = `${response.status} ${response.statusText}`;
			try {
				const body = (await response.json()) as OpenMeteoJson;
				if (body.reason) detail = body.reason;
			} catch {
				// ignore parse errors on error body
			}
			return {
				ok: false,
				error: `Open-Meteo request failed: ${detail}`,
				code: "http_error",
			};
		}

		const data = (await response.json()) as OpenMeteoJson;
		if (data.error && data.reason) {
			return { ok: false, error: data.reason, code: "http_error" };
		}

		const units = pickUnitLabels(params.temperatureUnit);
		const location = {
			latitude: data.latitude ?? params.latitude,
			longitude: data.longitude ?? params.longitude,
			timezone: data.timezone,
			elevation: data.elevation,
		};

		let daily: DailyWeatherSummary | undefined;
		if (params.detail === "daily" && data.daily?.time) {
			const times = data.daily.time as string[];
			const idx = times.findIndex((t) => t === params.date);
			if (idx >= 0) {
				const weatherCode = atIndex(
					data.daily.weather_code as number[] | undefined,
					idx,
				);
				daily = {
					date: params.date,
					weatherCode: weatherCode ?? null,
					weatherLabel: wmoCodeToLabel(
						typeof weatherCode === "number" ? weatherCode : null,
					),
					temperatureMax: atIndex(
						data.daily.temperature_2m_max as number[] | undefined,
						idx,
					) as number | null | undefined,
					temperatureMin: atIndex(
						data.daily.temperature_2m_min as number[] | undefined,
						idx,
					) as number | null | undefined,
					apparentTemperatureMax: atIndex(
						data.daily.apparent_temperature_max as number[] | undefined,
						idx,
					) as number | null | undefined,
					apparentTemperatureMin: atIndex(
						data.daily.apparent_temperature_min as number[] | undefined,
						idx,
					) as number | null | undefined,
					precipitationSum: atIndex(
						data.daily.precipitation_sum as number[] | undefined,
						idx,
					) as number | null | undefined,
					precipitationProbabilityMax: atIndex(
						data.daily.precipitation_probability_max as number[] | undefined,
						idx,
					) as number | null | undefined,
					windSpeedMax: atIndex(
						data.daily.wind_speed_10m_max as number[] | undefined,
						idx,
					) as number | null | undefined,
					windDirectionDominant: atIndex(
						data.daily.wind_direction_10m_dominant as number[] | undefined,
						idx,
					) as number | null | undefined,
					sunrise: atIndex(data.daily.sunrise as string[] | undefined, idx) as
						| string
						| null
						| undefined,
					sunset: atIndex(data.daily.sunset as string[] | undefined, idx) as
						| string
						| null
						| undefined,
				};
			}
		}

		let hourly: HourlyWeatherPoint[] | undefined;
		if (params.detail === "hourly" && data.hourly?.time) {
			const times = data.hourly.time as string[];
			hourly = [];
			for (let i = 0; i < times.length; i++) {
				const time = times[i];
				if (!time?.startsWith(params.date)) continue;
				const weatherCode = atIndex(
					data.hourly.weather_code as number[] | undefined,
					i,
				);
				hourly.push({
					time,
					temperature: atIndex(
						data.hourly.temperature_2m as number[] | undefined,
						i,
					) as number | null | undefined,
					relativeHumidity: atIndex(
						data.hourly.relative_humidity_2m as number[] | undefined,
						i,
					) as number | null | undefined,
					apparentTemperature: atIndex(
						data.hourly.apparent_temperature as number[] | undefined,
						i,
					) as number | null | undefined,
					precipitationProbability: atIndex(
						data.hourly.precipitation_probability as number[] | undefined,
						i,
					) as number | null | undefined,
					precipitation: atIndex(
						data.hourly.precipitation as number[] | undefined,
						i,
					) as number | null | undefined,
					weatherCode: (weatherCode as number | null | undefined) ?? null,
					weatherLabel: wmoCodeToLabel(
						typeof weatherCode === "number" ? weatherCode : null,
					),
					windSpeed: atIndex(
						data.hourly.wind_speed_10m as number[] | undefined,
						i,
					) as number | null | undefined,
					windDirection: atIndex(
						data.hourly.wind_direction_10m as number[] | undefined,
						i,
					) as number | null | undefined,
					cloudCover: atIndex(
						data.hourly.cloud_cover as number[] | undefined,
						i,
					) as number | null | undefined,
				});
			}
		}

		let current: CurrentWeather | undefined;
		if (params.includeCurrent && data.current) {
			const weatherCode =
				typeof data.current.weather_code === "number"
					? data.current.weather_code
					: null;
			current = {
				time:
					typeof data.current.time === "string" ? data.current.time : undefined,
				temperature:
					typeof data.current.temperature_2m === "number"
						? data.current.temperature_2m
						: null,
				relativeHumidity:
					typeof data.current.relative_humidity_2m === "number"
						? data.current.relative_humidity_2m
						: null,
				apparentTemperature:
					typeof data.current.apparent_temperature === "number"
						? data.current.apparent_temperature
						: null,
				weatherCode,
				weatherLabel: wmoCodeToLabel(weatherCode),
				windSpeed:
					typeof data.current.wind_speed_10m === "number"
						? data.current.wind_speed_10m
						: null,
				windDirection:
					typeof data.current.wind_direction_10m === "number"
						? data.current.wind_direction_10m
						: null,
				precipitation:
					typeof data.current.precipitation === "number"
						? data.current.precipitation
						: null,
				cloudCover:
					typeof data.current.cloud_cover === "number"
						? data.current.cloud_cover
						: null,
				isDay:
					typeof data.current.is_day === "number"
						? data.current.is_day === 1
						: typeof data.current.is_day === "boolean"
							? data.current.is_day
							: null,
			};
		}

		if (params.detail === "daily" && !daily && !current) {
			return {
				ok: false,
				error: `No forecast data available for ${params.date}. Open-Meteo typically covers about 7–16 days from today.`,
				code: "no_data",
			};
		}
		if (
			params.detail === "hourly" &&
			(!hourly || hourly.length === 0) &&
			!current
		) {
			return {
				ok: false,
				error: `No hourly forecast data available for ${params.date}. Open-Meteo typically covers about 7–16 days from today.`,
				code: "no_data",
			};
		}

		return {
			ok: true,
			source: "Open-Meteo",
			attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
			location,
			date: params.date,
			detail: params.detail,
			units,
			...(daily ? { daily } : {}),
			...(hourly ? { hourly } : {}),
			...(current ? { current } : {}),
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message, code: "http_error" };
	}
}
