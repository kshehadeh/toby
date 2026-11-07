import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const embeddedPlist = readFileSync(
	new URL("apps/toby-app/Sources/TobyApp/Info.plist", root),
	"utf8",
);
const buildScript = readFileSync(new URL("scripts/build-app.sh", root), "utf8");
const packagedPlist = buildScript.match(
	/cat >"\$\{APP\}\/Contents\/Info\.plist" <<'PLIST'\n([\s\S]*?)\nPLIST/,
)?.[1];

function parsePlist(xml: string): Record<string, unknown> {
	// Use the same plist parser available to the Python-based build script.
	const result = Bun.spawnSync(
		[
			"python3",
			"-c",
			"import json, plistlib, sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))",
		],
		{ stdin: Buffer.from(xml), cwd: fileURLToPath(root) },
	);
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout.toString());
}

describe("Toby.app Bluetooth privacy declarations", () => {
	it("declares a Bluetooth usage explanation in the embedded plist", () => {
		const description =
			parsePlist(embeddedPlist).NSBluetoothAlwaysUsageDescription;
		expect(typeof description).toBe("string");
		expect((description as string).trim().length).toBeGreaterThan(0);
	});

	it("ships the same explanation in the packaged app plist", () => {
		expect(packagedPlist).toBeDefined();
		const description = parsePlist(
			packagedPlist ?? "",
		).NSBluetoothAlwaysUsageDescription;
		expect(typeof description).toBe("string");
		expect((description as string).trim().length).toBeGreaterThan(0);
		expect(description).toBe(
			parsePlist(embeddedPlist).NSBluetoothAlwaysUsageDescription,
		);
	});
});
