# Location (`getMyLocation`)

Built-in global tool that reads the **running user’s current location** from
macOS Location Services via **Toby.app**. No plugin or Settings toggle is
required.

## How it works

`getMyLocation` is a **client-side function tool**. When the model calls it:

1. Core calls Toby.app’s native API (`POST /api/native/location/current`).
2. If Toby.app is not running, it is auto-launched and the native server is
   discovered via `~/.toby/native-port`.
3. Toby.app requests **Location Services** access when not already granted
   (TCC prompt is tied to Toby.app’s bundle identity).
4. CoreLocation returns a one-shot fix; optionally reverse-geocodes to a place
   name (city, region, country).

macOS only. On other platforms the tool returns `unsupported_platform`.

## Permissions

Grant **Location** for **Toby.app** in:

- Toby.app → **Permissions** (Location Access card), or
- **System Settings → Privacy & Security → Location Services**

The Permissions window and the tool both trigger the system prompt when status
is not yet determined.

## Chat tool

| Tool | Purpose |
| ---- | ------- |
| `getMyLocation` | Current lat/lon (+ optional reverse-geocoded place). Inputs: `accuracy` (`best` \| `hundredMeters` \| `kilometer`), `reverseGeocode` (default true). |

`getMyLocation` is available in every chat session (not gated by a Settings
enable flag). Pretreatment / semantic routing may still select it only when
relevant, but the tool is always registered on the global tool set.

Use it for **current** position (“where am I”, “near me”). Questions about
where the user **lives** or a **saved home address** should search memory
first — see [`memory.md`](memory.md).

### Example response shape

```json
{
  "ok": true,
  "latitude": 37.7749,
  "longitude": -122.4194,
  "horizontalAccuracyMeters": 25,
  "timestamp": "2026-07-12T12:00:00Z",
  "place": {
    "locality": "San Francisco",
    "administrativeArea": "CA",
    "country": "United States",
    "displayName": "San Francisco, CA, United States"
  }
}
```

When access is denied:

```json
{
  "ok": false,
  "error": "Location access denied.",
  "needsPermission": true,
  "code": "permission_denied"
}
```

## Architecture

| Layer | Location |
| ----- | -------- |
| Tool factory | [`packages/core/src/ai/location-global-tools.ts`](../packages/core/src/ai/location-global-tools.ts) |
| Native HTTP client | [`packages/core/src/native-app/client.ts`](../packages/core/src/native-app/client.ts) |
| CoreLocation handler | [`apps/toby-app/Sources/TobyApp/Native/NativeLocationHandler.swift`](../apps/toby-app/Sources/TobyApp/Native/NativeLocationHandler.swift) |
| Native routes | [`apps/toby-app/Sources/TobyApp/Native/NativeServer.swift`](../apps/toby-app/Sources/TobyApp/Native/NativeServer.swift) |
| Permissions UI | [`apps/toby-app/Sources/TobyApp/Stores/PermissionsStore.swift`](../apps/toby-app/Sources/TobyApp/Stores/PermissionsStore.swift) |

### Native endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/native/location/status` | Authorization status without prompting |
| `POST` | `/api/native/location/request-access` | Prompt for Location Services |
| `POST` | `/api/native/location/current` | One-shot location (prompts if needed) |

See also [`native-helpers.md`](native-helpers.md) and the help-site
[Native API](../apps/help-site/docs/api/native-api.md) reference.

## Interaction with weather

When Weather is enabled and the user asks about weather “here” / “near me”
without a place name, the model should call **`getMyLocation`** first, then
pass coordinates or the reverse-geocoded place into **`getWeather`**.

## Limits

- Requires Toby.app and Location Services enabled system-wide.
- Fix accuracy and reverse geocoding depend on network and hardware; a timeout
  is returned if no fix is available in time.
- Precise location is privacy-sensitive; the model should not store precise
  coordinates in memory unless the user explicitly wants that remembered.
