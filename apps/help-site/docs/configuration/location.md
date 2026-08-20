---
sidebar_position: 4
title: Location
---

# Location

Location is a **built-in** chat capability—not an installable integration. The
`getMyLocation` tool is available in chat on macOS so Toby can answer “where am
I?” and handle “near me” / “here” requests.

Toby reads your position through **Toby.app** and macOS **Location Services**.
The first time the tool runs (or when you click **Allow** in Permissions), macOS
asks you to grant Location access to **Toby.app**.

## How it works

When the model calls `getMyLocation`, Toby:

1. Talks to Toby.app’s local Native API.
2. Requests Location Services access if you have not already allowed it.
3. Returns your approximate coordinates and, when possible, a place name (city,
   region, country).

No Settings toggle or API key is required. Location Services must be turned on
system-wide.

## Grant permission

You can allow access in either place:

1. **Toby.app → File → Permissions… → Location Access → Allow**
2. **System Settings → Privacy & Security → Location Services → Toby**

If access was previously denied, use System Settings (or **Open System Settings**
from the Permissions card) to re-enable it.

## Using location in chat

Ask natural questions such as:

- “Where am I right now?”
- “What’s my current location?”
- “What’s the weather near me?” (with [Weather](./weather) enabled, Toby may
  call `getMyLocation` first)

Toby should use **`getMyLocation`** instead of guessing your city.

Ask **“where do I live?”** or **“what’s my home address?”** when you want a
**saved memory**, not the Mac’s current GPS fix. See [Memories](../memories).

## Privacy

Precise location is sensitive. Toby uses it only when a tool call needs it for
your request. You can revoke access anytime in System Settings → Location
Services.

## Related

- [Weather](./weather) — forecasts; pairs with location for “near me”
- [Native API](../api/native-api) — `/api/native/location/*` endpoints
- [Toby Mac App](../toby-app) — Permissions window and native bridge
