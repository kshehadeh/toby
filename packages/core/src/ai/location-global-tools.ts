import { type Tool, tool } from "ai";
import { z } from "zod";
import { nativeAppRequest } from "../native-app/client";

export type LocationToolContext = {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
	/**
	 * Injected for tests. When set, skips the real Toby.app native call.
	 */
	readonly requestImpl?: typeof nativeAppRequest;
};

function isMacOS(): boolean {
	return process.platform === "darwin";
}

/**
 * Build the `getMyLocation` global tool. Always registered on macOS; on other
 * platforms the tool still exists but returns a clear unsupported error so the
 * model can fall back (e.g. ask the user or use a named place).
 */
export function createLocationGlobalTools(
	ctx: LocationToolContext,
): Record<string, Tool> {
	const request = ctx.requestImpl ?? nativeAppRequest;

	return {
		getMyLocation: tool({
			description:
				"Get the running user's current geographic location from this Mac (latitude/longitude, accuracy, and reverse-geocoded place when available). Triggers the macOS Location Services permission prompt for Toby.app if access has not been granted yet. Use when the user asks where they are, for local weather/nearby context without a place name, or when a tool needs the user's coordinates. macOS only.",
			inputSchema: z.object({
				accuracy: z
					.enum(["best", "hundredMeters", "kilometer"])
					.optional()
					.describe(
						"Desired fix accuracy. Default hundredMeters balances speed and precision.",
					),
				reverseGeocode: z
					.boolean()
					.optional()
					.describe(
						"When true (default), include a reverse-geocoded place (city, region, country).",
					),
			}),
			execute: async (input) => {
				if (!isMacOS()) {
					return {
						ok: false as const,
						error:
							"getMyLocation is only available on macOS (requires Toby.app Location Services).",
						code: "unsupported_platform" as const,
					};
				}

				const accuracy = input.accuracy ?? "hundredMeters";
				const reverseGeocode = input.reverseGeocode ?? true;

				if (ctx.dryRun) {
					const msg = `[dry-run] Would request current location (accuracy=${accuracy}, reverseGeocode=${reverseGeocode})`;
					ctx.appliedActions.push(msg);
					return {
						ok: true as const,
						dryRun: true as const,
						accuracy,
						reverseGeocode,
						message: msg,
					};
				}

				const response = await request("location/current", {
					method: "POST",
					body: {
						accuracy,
						reverseGeocode,
					},
					// Permission prompt + GPS fix can take a while.
					timeoutMs: 45_000,
				});

				if (!response.ok) {
					return {
						ok: false as const,
						error:
							response.error ?? "Could not determine the current location.",
						needsPermission: response.needsPermission === true,
						code: response.needsPermission
							? ("permission_denied" as const)
							: ("location_failed" as const),
					};
				}

				const data = response.data ?? {};
				return {
					ok: true as const,
					...data,
				};
			},
		}),
	};
}
