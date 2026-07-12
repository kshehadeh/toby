import { describe, expect, it } from "bun:test";
import { createLocationGlobalTools } from "@toby/core/ai/location-global-tools";
import type { NativeAppResponse } from "@toby/core/native-app/client";

describe("createLocationGlobalTools", () => {
	it("registers getMyLocation", () => {
		const tools = createLocationGlobalTools({
			dryRun: true,
			appliedActions: [],
		});
		expect(Object.keys(tools)).toEqual(["getMyLocation"]);
		expect(tools.getMyLocation).toBeDefined();
	});

	it("dry-run returns a preview without calling native", async () => {
		const appliedActions: string[] = [];
		let called = false;
		const tools = createLocationGlobalTools({
			dryRun: true,
			appliedActions,
			requestImpl: async () => {
				called = true;
				return { ok: false, error: "should not be called" };
			},
		});

		const result = await tools.getMyLocation?.execute?.(
			{ accuracy: "best" },
			{
				toolCallId: "t1",
				messages: [],
				abortSignal: new AbortController().signal,
			},
		);

		expect(called).toBe(false);
		expect(result).toMatchObject({
			ok: true,
			dryRun: true,
			accuracy: "best",
			reverseGeocode: true,
		});
		expect(appliedActions.length).toBe(1);
		expect(appliedActions[0]).toContain("dry-run");
	});

	it("returns coordinates from the native client", async () => {
		if (process.platform !== "darwin") {
			// Tool short-circuits on non-macOS before the mock runs.
			return;
		}

		const mockResponse: NativeAppResponse = {
			ok: true,
			data: {
				latitude: 37.7749,
				longitude: -122.4194,
				horizontalAccuracyMeters: 25,
				timestamp: "2026-07-12T12:00:00Z",
				place: {
					locality: "San Francisco",
					administrativeArea: "CA",
					country: "United States",
					displayName: "San Francisco, CA, United States",
				},
			},
		};

		const tools = createLocationGlobalTools({
			dryRun: false,
			appliedActions: [],
			requestImpl: async (endpoint, options) => {
				expect(endpoint).toBe("location/current");
				expect(options?.body).toMatchObject({
					accuracy: "hundredMeters",
					reverseGeocode: true,
				});
				return mockResponse;
			},
		});

		const result = (await tools.getMyLocation?.execute?.(
			{},
			{
				toolCallId: "t2",
				messages: [],
				abortSignal: new AbortController().signal,
			},
		)) as Record<string, unknown>;

		expect(result.ok).toBe(true);
		expect(result.latitude).toBe(37.7749);
		expect(result.longitude).toBe(-122.4194);
		expect(result.place).toMatchObject({
			locality: "San Francisco",
		});
	});

	it("surfaces needsPermission when native denies access", async () => {
		if (process.platform !== "darwin") {
			return;
		}

		const tools = createLocationGlobalTools({
			dryRun: false,
			appliedActions: [],
			requestImpl: async () => ({
				ok: false,
				error: "Location access denied.",
				needsPermission: true,
			}),
		});

		const result = (await tools.getMyLocation?.execute?.(
			{},
			{
				toolCallId: "t3",
				messages: [],
				abortSignal: new AbortController().signal,
			},
		)) as Record<string, unknown>;

		expect(result).toMatchObject({
			ok: false,
			needsPermission: true,
			code: "permission_denied",
		});
	});

	it("returns unsupported_platform off macOS", async () => {
		if (process.platform === "darwin") {
			return;
		}

		const tools = createLocationGlobalTools({
			dryRun: false,
			appliedActions: [],
			requestImpl: async () => ({
				ok: true,
				data: { latitude: 0, longitude: 0 },
			}),
		});

		const result = (await tools.getMyLocation?.execute?.(
			{},
			{
				toolCallId: "t4",
				messages: [],
				abortSignal: new AbortController().signal,
			},
		)) as Record<string, unknown>;

		expect(result).toMatchObject({
			ok: false,
			code: "unsupported_platform",
		});
	});
});
