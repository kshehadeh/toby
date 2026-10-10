import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as native from "../src/native-client";
import { executeTool } from "../src/tools";

afterEach(() => mock.restore());

describe("file discovery", () => {
	it("forwards folder filtering and pagination without recording a mutation", () => {
		spyOn(native, "isNativeAvailable").mockReturnValue(true);
		const data = {
			entries: [{ name: "photo.png", path: "/Downloads/photo.png" }],
			nextOffset: 20,
			hasMore: true,
		};
		const request = spyOn(native, "nativeRequest").mockReturnValue({
			ok: true,
			data,
		});
		const input = { folder: "downloads", kind: "images", limit: 20, offset: 0 };
		const result = executeTool("macFilesList", input, false);
		expect(request).toHaveBeenCalledWith("macos/files-list", input);
		expect(result.result).toEqual({ ...data, ok: true });
		expect(result.appliedActions).toEqual([]);
	});

	it("preserves permission failures for chat", () => {
		spyOn(native, "isNativeAvailable").mockReturnValue(true);
		spyOn(native, "nativeRequest").mockReturnValue({
			ok: false,
			error: "Allow Toby in Files and Folders.",
			needsPermission: true,
		});
		const result = executeTool("macFilesList", { folder: "downloads" }, false);
		expect(result.result.needsPermission).toBe(true);
		expect(result.result.error).toContain("Files and Folders");
		expect(result.result.ok).toBe(false);
	});

	it("does not access protected folders in dry run", () => {
		const request = spyOn(native, "nativeRequest");
		expect(executeTool("macFilesList", {}, true).result.dryRun).toBe(true);
		expect(request).not.toHaveBeenCalled();
	});
});
