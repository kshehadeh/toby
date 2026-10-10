import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { type FileContext, executeImageTool } from "../src/engine";

let directory: string;
let files: FileContext;
const input = (extra: Record<string, unknown> = {}) => ({
	source: "attachment:test.png",
	outputName: "result.png",
	...extra,
});
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "toby-images-"));
	const data = await sharp(
		Buffer.from([
			255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 0,
		]),
		{ raw: { width: 3, height: 2, channels: 3 } },
	)
		.png()
		.toBuffer();
	files = {
		source: { filename: "test.png", dataBase64: data.toString("base64") },
		outputDir: directory,
	};
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});
async function outputPixels() {
	return sharp(path.join(directory, "result.png"))
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
}

describe("image processing", () => {
	it("inspects dimensions without writing", async () => {
		const { result } = await executeImageTool(
			"imagesInspect",
			{ source: "attachment:test.png" },
			files,
			false,
		);
		expect(result).toMatchObject({
			width: 3,
			height: 2,
			format: "png",
			pages: 1,
		});
		expect(await fs.readdir(directory)).toEqual([]);
	});
	it("converts the chat's PNG-to-JPEG request despite unused PNG settings", async () => {
		const result = await executeImageTool(
			"imagesConvert",
			input({
				outputName: "converted.jpg",
				format: "jpeg",
				quality: 85,
				lossless: false,
				compressionLevel: 6,
				background: "#FFFFFF",
			}),
			files,
			false,
		);
		const output = path.join(directory, "converted.jpg");
		expect(result.result).toMatchObject({
			format: "jpeg",
			path: output,
			quality: 85,
		});
		expect(result.result.markdown).toContain("Download converted.jpg");
		expect(await sharp(output).metadata()).toMatchObject({
			format: "jpeg",
			width: 3,
			height: 2,
		});
	});
	it("treats null optional encoder settings as omitted", async () => {
		const result = await executeImageTool(
			"imagesConvert",
			input({
				outputName: null,
				format: "jpeg",
				quality: null,
				lossless: null,
				compressionLevel: null,
				background: null,
			}),
			files,
			false,
		);
		expect(result.result).toMatchObject({ format: "jpeg", quality: 85 });
		expect(await sharp(result.result.path).metadata()).toMatchObject({
			format: "jpeg",
		});
	});
	it("ignores visual quality for lossless PNG encoding", async () => {
		await executeImageTool(
			"imagesConvert",
			input({ quality: 85, compressionLevel: 9 }),
			files,
			false,
		);
		const output = await outputPixels();
		expect(output.data).toEqual(
			await sharp(Buffer.from(files.source.dataBase64 ?? "", "base64"))
				.raw()
				.toBuffer(),
		);
	});
	it("rotates then flips then crops exact pixels", async () => {
		await executeImageTool(
			"imagesTransform",
			input({
				rotate: 90,
				flipHorizontal: true,
				crop: { left: 0, top: 0, width: 1, height: 2 },
			}),
			files,
			false,
		);
		const pixels = await outputPixels();
		expect(pixels.info).toMatchObject({ width: 1, height: 2 });
		expect([...pixels.data]).toEqual([255, 0, 0, 0, 255, 0]);
	});
	it("centre-crops and resizes", async () => {
		await executeImageTool(
			"imagesTransform",
			input({ aspectRatio: 1, width: 1, height: 1 }),
			files,
			false,
		);
		expect((await outputPixels()).info).toMatchObject({ width: 1, height: 1 });
	});
	it("makes saturation zero grayscale", async () => {
		await executeImageTool(
			"imagesTransform",
			input({ saturation: 0 }),
			files,
			false,
		);
		const pixels = (await outputPixels()).data;
		for (let i = 0; i < pixels.length; i += 3) {
			expect(
				Math.abs((pixels[i] ?? 0) - (pixels[i + 1] ?? 0)),
			).toBeLessThanOrEqual(1);
			expect(
				Math.abs((pixels[i] ?? 0) - (pixels[i + 2] ?? 0)),
			).toBeLessThanOrEqual(1);
		}
	});
	it("validates dry-run without creating the output directory", async () => {
		files.outputDir = path.join(directory, "not-created");
		const { result } = await executeImageTool(
			"imagesTransform",
			input({ width: 1 }),
			files,
			true,
		);
		expect(result).toMatchObject({ dryRun: true });
		expect(await fs.readdir(directory)).toEqual([]);
		await expect(
			executeImageTool(
				"imagesTransform",
				input({ crop: { left: 2, top: 0, width: 2, height: 1 } }),
				files,
				true,
			),
		).rejects.toThrow();
	});
	it("never overwrites originals or existing destinations", async () => {
		const original = Buffer.from(files.source.dataBase64 ?? "", "base64");
		const source = path.join(directory, "test.png");
		await fs.writeFile(source, original);
		files.source = { path: source, filename: "test.png" };
		await expect(
			executeImageTool(
				"imagesConvert",
				input({ outputName: "test.png" }),
				files,
				false,
			),
		).rejects.toThrow("already exists");
		expect(await fs.readFile(source)).toEqual(original);
		await executeImageTool("imagesConvert", input(), files, false);
		await expect(
			executeImageTool("imagesConvert", input(), files, false),
		).rejects.toThrow("already exists");
		expect(
			(await fs.readdir(directory)).filter((name) =>
				name.startsWith(".images"),
			),
		).toEqual([]);
	});
	it("publishes only one output when concurrent writes choose the same name", async () => {
		const attempts = await Promise.allSettled([
			executeImageTool("imagesConvert", input(), files, false),
			executeImageTool("imagesConvert", input(), files, false),
		]);
		expect(
			attempts.filter((attempt) => attempt.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			attempts.filter((attempt) => attempt.status === "rejected"),
		).toHaveLength(1);
		expect(await fs.readdir(directory)).toEqual(["result.png"]);
	});
	it("rejects oversized local files before decoding", async () => {
		const source = path.join(directory, "huge.png");
		const handle = await fs.open(source, "w");
		await handle.truncate(50 * 1024 * 1024 + 1);
		await handle.close();
		files.source = { path: source, filename: "huge.png" };
		await expect(
			executeImageTool("imagesConvert", input(), files, false),
		).rejects.toThrow("50 MB");
		expect(await fs.readdir(directory)).toEqual(["huge.png"]);
	});
	it("converts alpha to JPEG on an explicit background", async () => {
		const data = await sharp({
			create: {
				width: 8,
				height: 8,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.png()
			.toBuffer();
		files.source.dataBase64 = data.toString("base64");
		const { result } = await executeImageTool(
			"imagesConvert",
			input({
				format: "jpeg",
				outputName: "result.jpg",
				quality: 100,
				background: "#ff0000",
			}),
			files,
			false,
		);
		expect(result).toMatchObject({ format: "jpeg", mediaType: "image/jpeg" });
		const pixels = await sharp(path.join(directory, "result.jpg"))
			.raw()
			.toBuffer();
		expect(pixels[0]).toBeGreaterThan(250);
		expect(pixels[1]).toBeLessThan(3);
		expect(pixels[2]).toBeLessThan(3);
	});
	it("reports successful and impossible compression targets", async () => {
		const success = await executeImageTool(
			"imagesCompress",
			input({ format: "webp", outputName: "ok.webp", targetBytes: 1000 }),
			files,
			false,
		);
		expect(success.result).toMatchObject({ targetMet: true });
		const impossible = await executeImageTool(
			"imagesCompress",
			input({ format: "jpeg", outputName: "small.jpg", targetBytes: 1 }),
			files,
			false,
		);
		expect(impossible.result).toMatchObject({
			targetMet: false,
			quality: 30,
			width: 3,
			height: 2,
		});
	});
	it("normalizes EXIF orientation and strips metadata", async () => {
		const data = await sharp(
			Buffer.from(files.source.dataBase64 ?? "", "base64"),
		)
			.withMetadata({ orientation: 6 })
			.jpeg()
			.toBuffer();
		files.source = {
			filename: "photo.jpg",
			dataBase64: data.toString("base64"),
		};
		const inspection = await executeImageTool(
			"imagesInspect",
			{ source: "attachment:photo.jpg" },
			files,
			false,
		);
		expect(inspection.result).toMatchObject({
			width: 2,
			height: 3,
			storedWidth: 3,
			storedHeight: 2,
			orientation: 6,
		});
		await executeImageTool(
			"imagesTransform",
			input({ format: "png" }),
			files,
			false,
		);
		const metadata = await sharp(path.join(directory, "result.png")).metadata();
		expect(metadata).toMatchObject({ width: 2, height: 3 });
		expect(metadata.exif).toBeUndefined();
		expect(metadata.orientation).toBeUndefined();
	});
	it("rejects bad parameters, path escapes, and symlink destinations", async () => {
		for (const params of [
			{ outputName: "../escape.png" },
			{ targetBytes: 85 },
			{ width: 40000000, height: 2 },
			{ crop: { left: -1, top: 0, width: 1, height: 1 } },
			{ rotate: 45 },
			{ brightness: Number.NaN },
		]) {
			await expect(
				executeImageTool("imagesTransform", input(params), files, false),
			).rejects.toThrow();
		}
		await fs.symlink(directory, path.join(directory, "alias"));
		await expect(
			executeImageTool(
				"imagesConvert",
				input(),
				{ ...files, outputDir: path.join(directory, "alias") },
				false,
			),
		).rejects.toThrow("symlink");
		expect(await fs.readdir(directory)).toEqual(["alias"]);
	});
	it("rejects corrupt and unsupported files without outputs", async () => {
		files.source.dataBase64 = Buffer.from("broken").toString("base64");
		await expect(
			executeImageTool("imagesConvert", input(), files, false),
		).rejects.toThrow();
		files.source.dataBase64 = Buffer.from(
			'<svg width="2" height="2"><rect width="2" height="2"/></svg>',
		).toString("base64");
		await expect(
			executeImageTool("imagesConvert", input(), files, false),
		).rejects.toThrow("Only still");
		expect(await fs.readdir(directory)).toEqual([]);
	});
});
