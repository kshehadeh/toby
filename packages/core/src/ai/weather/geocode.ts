import { getTobyVersion } from "../../version";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const GEOCODE_TIMEOUT_MS = 12_000;

export interface GeocodeResult {
	readonly latitude: number;
	readonly longitude: number;
	readonly displayName: string;
	readonly raw?: unknown;
}

/**
 * Pluggable geocoder. The default is Nominatim; the implementation may change
 * without changing the `getWeather` tool input schema.
 */
export interface Geocoder {
	readonly id: string;
	geocode(query: string): Promise<GeocodeResult | null>;
}

function weatherUserAgent(): string {
	return `Toby/${getTobyVersion()} (https://github.com/kshehadeh/toby)`;
}

/**
 * Nominatim free-form search geocoder.
 * @see https://nominatim.org/release-docs/latest/api/Search/
 */
export function createNominatimGeocoder(
	fetchImpl: typeof fetch = fetch,
): Geocoder {
	return {
		id: "nominatim",
		async geocode(query: string): Promise<GeocodeResult | null> {
			const q = query.trim();
			if (!q) return null;

			const url = new URL(NOMINATIM_SEARCH_URL);
			url.searchParams.set("q", q);
			url.searchParams.set("format", "jsonv2");
			url.searchParams.set("limit", "1");

			const response = await fetchImpl(url.toString(), {
				headers: {
					"User-Agent": weatherUserAgent(),
					Accept: "application/json",
				},
				signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
			});

			if (!response.ok) {
				throw new Error(
					`Geocoding failed: HTTP ${response.status} ${response.statusText}`,
				);
			}

			const data = (await response.json()) as Array<{
				lat?: string;
				lon?: string;
				display_name?: string;
			}>;

			const first = data[0];
			if (!first?.lat || !first?.lon) {
				return null;
			}

			const latitude = Number.parseFloat(first.lat);
			const longitude = Number.parseFloat(first.lon);
			if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
				return null;
			}

			return {
				latitude,
				longitude,
				displayName: first.display_name?.trim() || q,
				raw: first,
			};
		},
	};
}

/** Default geocoder used by the weather tool (Nominatim today; may change). */
export function createDefaultGeocoder(
	fetchImpl: typeof fetch = fetch,
): Geocoder {
	return createNominatimGeocoder(fetchImpl);
}
