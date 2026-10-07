import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as native from "../src/native-client";
import { executeTool } from "../src/tools";

afterEach(() => mock.restore());

describe("application tools", () => {
	it("does not touch native APIs when quitting in dry run", () => {
		const available = spyOn(native, "isNativeAvailable").mockImplementation(
			() => {
				throw new Error("Native API must not be called");
			},
		);
		const request = spyOn(native, "nativeRequest");
		const result = executeTool("macAppQuit", { appName: " Safari " }, true);
		expect(result.result.dryRun).toBe(true);
		expect(result.appliedActions).toEqual([]);
		expect(available).not.toHaveBeenCalled();
		expect(request).not.toHaveBeenCalled();
	});

	it("rejects an empty quit target before contacting the native server", () => {
		const request = spyOn(native, "nativeRequest");
		for (const appName of [undefined, "", "   ", 42]) {
			expect(() => executeTool("macAppQuit", { appName }, false)).toThrow(
				"appName is required",
			);
		}
		expect(request).not.toHaveBeenCalled();
	});

	it("reports a quit request without claiming the app exited", () => {
		spyOn(native, "isNativeAvailable").mockReturnValue(true);
		const request = spyOn(native, "nativeRequest").mockReturnValue({
			ok: true,
			data: { quitRequested: true, app: { name: "Safari" } },
		});
		const result = executeTool("macAppQuit", { appName: " Safari " }, false);
		expect(request).toHaveBeenCalledWith("macos/app-quit", {
			appName: "Safari",
		});
		expect(result.result.quitRequested).toBe(true);
		expect(result.appliedActions).toEqual([
			'Requested a normal quit of "Safari".',
		]);
	});

	it("does not record an action when the native server rejects the target", () => {
		spyOn(native, "isNativeAvailable").mockReturnValue(true);
		spyOn(native, "nativeRequest").mockReturnValue({
			ok: false,
			error: "Multiple running applications matched.",
		});
		const result = executeTool("macAppQuit", { appName: "Safari" }, false);
		expect(result.result.ok).toBe(false);
		expect(result.appliedActions).toEqual([]);
	});

	it("allows read-only discovery in dry run and forwards filters and app details", () => {
		spyOn(native, "isNativeAvailable").mockReturnValue(true);
		const apps = [{ name: "Safari", processIdentifier: 123, isHidden: true }];
		const request = spyOn(native, "nativeRequest").mockReturnValue({
			ok: true,
			data: { apps, count: 1 },
		});
		const result = executeTool(
			"macAppsRunning",
			{ appName: " Safari ", includeBackground: true },
			true,
		);
		expect(request).toHaveBeenCalledWith("macos/apps-running", {
			appName: "Safari",
			includeBackground: true,
		});
		expect(result.result.apps).toEqual(apps);
		expect(result.appliedActions).toEqual([]);
	});
});
