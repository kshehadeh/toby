# Weather

Built-in weather via **Open-Meteo** (global forecast). No plugin required. Place
names are geocoded with **Nominatim** (default; implementation may change).

## How it works

`getWeather` is a **client-side function tool**. When the model calls it:

1. Resolve coordinates from `latitude`/`longitude`, or geocode `location` (or
   Settings default location) via the geocoder.
2. Call Open-Meteo Forecast API (`/v1/forecast`) for the requested date.
3. Return structured daily or hourly data (plus current conditions when the date
   is today), including WMO weather-code labels.

Free tier needs **no API key**. An optional customer API key switches the base
URL to `customer-api.open-meteo.com` and passes `apikey`.

## Setup

1. Open **Settings → Weather**.
2. Set **Enabled** to **On**.
3. Optionally set **Default location**, **Temperature unit**, and **Open-Meteo API key**.

## Configuration

| Setting | Key | Storage | Description |
| ------- | --- | ------- | ----------- |
| Enabled | `weather.enabled` | `config.json` | Master switch for the global tool. |
| Default location | `weather.defaultLocation` | `config.json` | Used when the tool call omits place and coordinates. |
| Temperature unit | `weather.temperatureUnit` | `config.json` | `celsius` (default) or `fahrenheit`. |
| Open-Meteo API key | `weather.apiKey` | `credentials.json` | Optional customer/paid key. |

## Chat tool

| Tool | Purpose |
| ---- | ------- |
| `getWeather` | Structured weather for a place (or lat/lon) and optional date. Inputs: `location`, `latitude`, `longitude`, `date` (`YYYY-MM-DD`), `detail` (`daily` \| `hourly`), `temperatureUnit`. |

`getWeather` is a **conditional global tool**: when enabled, it is available in
every chat session. It is **not** in the always-included tool set; pretreatment /
semantic routing selects it for weather-related turns.

## Architecture

| Layer | Location |
| ----- | -------- |
| Tool factory | [`packages/core/src/ai/weather/weather-global-tools.ts`](../packages/core/src/ai/weather/weather-global-tools.ts) |
| Open-Meteo client | [`packages/core/src/ai/weather/open-meteo.ts`](../packages/core/src/ai/weather/open-meteo.ts) |
| Geocoder (Nominatim default) | [`packages/core/src/ai/weather/geocode.ts`](../packages/core/src/ai/weather/geocode.ts) |
| WMO code labels | [`packages/core/src/ai/weather/wmo-codes.ts`](../packages/core/src/ai/weather/wmo-codes.ts) |
| Config schema (`WeatherConfig`) | [`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts) |
| Configure tree (Weather section) | [`packages/core/src/configure/tree.ts`](../packages/core/src/configure/tree.ts) |
| Configure persistence | [`packages/core/src/configure/persistence.ts`](../packages/core/src/configure/persistence.ts) |

### Geocoding note

The geocoder is behind a small `Geocoder` interface so the provider can change
without changing the `getWeather` input schema. v1 uses public Nominatim with a
descriptive User-Agent (`Toby/{version}`).

### Attribution

Weather data by [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Responses
include an `attribution` field for the model to surface when appropriate.

## Limits

- Forecast horizon is model-dependent (typically about 7–16 days). Dates outside
  the available window return a structured error (`no_data`).
- Historical climate archives are out of scope for v1.
