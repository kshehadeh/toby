import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { TOOL_DEFINITIONS } from "./tools";

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
const FORMATS = ["jpeg", "png", "webp"] as const;
type Format = (typeof FORMATS)[number];
type Input = Record<string, unknown>;
export type FileContext = {
	source: { path?: string; dataBase64?: string; filename: string };
	outputDir: string;
};
export class ImageFailure extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message);
	}
}
function fail(code: string, message: string): never {
	throw new ImageFailure(code, message);
}
function numeric(
	input: Input,
	key: string,
	min: number,
	max: number,
	fallback?: number,
	integral = false,
): number | undefined {
	const value = input[key];
	if (value === undefined) return fallback;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integral && !Number.isInteger(value))
	)
		fail(
			"invalid_input",
			`${key} must be ${integral ? "an integer" : "a number"} between ${min} and ${max}.`,
		);
	return value;
}
function boolean(input: Input, key: string): boolean {
	if (input[key] !== undefined && typeof input[key] !== "boolean")
		fail("invalid_input", `${key} must be boolean.`);
	return input[key] === true;
}
function record(value: unknown): Input {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail("invalid_input", "crop must be an object.");
	return value as Input;
}
const decoder = (bytes: Buffer) =>
	sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "warning" }).timeout({
		seconds: 15,
	});

async function readSource(source: FileContext["source"]): Promise<Buffer> {
	if (source.dataBase64 !== undefined) {
		if (source.dataBase64.length > Math.ceil(MAX_BYTES / 3) * 4)
			fail("input_too_large", "Image exceeds 50 MB.");
		const bytes = Buffer.from(source.dataBase64, "base64");
		if (bytes.length > MAX_BYTES)
			fail("input_too_large", "Image exceeds 50 MB.");
		return bytes;
	}
	if (!source.path || !path.isAbsolute(source.path))
		fail("invalid_source", "An absolute local source path is required.");
	const handle = await fs.open(source.path, "r");
	try {
		const stat = await handle.stat();
		if (!stat.isFile())
			fail("invalid_source", "Source must be a regular file.");
		if (stat.size > MAX_BYTES) fail("input_too_large", "Image exceeds 50 MB.");
		// Bounded read even when the source grows during processing.
		const bytes = Buffer.alloc(stat.size + 1);
		let bytesRead = 0;
		while (bytesRead < bytes.length) {
			const chunk = await handle.read(
				bytes,
				bytesRead,
				bytes.length - bytesRead,
				bytesRead,
			);
			if (chunk.bytesRead === 0) break;
			bytesRead += chunk.bytesRead;
		}
		if (bytesRead > stat.size)
			fail("invalid_source", "Source changed while reading.");
		return bytes.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

async function inspect(bytes: Buffer) {
	const metadata = await decoder(bytes).metadata();
	if (!FORMATS.includes(metadata.format as Format))
		fail(
			"unsupported_format",
			"Only still JPEG, PNG, and WebP images are supported.",
		);
	if ((metadata.pages ?? 1) !== 1)
		fail(
			"unsupported_animation",
			"Animated or multi-page images are not supported.",
		);
	const storedWidth = metadata.width ?? 0;
	const storedHeight = metadata.height ?? 0;
	if (!storedWidth || !storedHeight || storedWidth * storedHeight > MAX_PIXELS)
		fail(
			"input_too_large",
			"Image exceeds 40 megapixels or has invalid dimensions.",
		);
	const swap = (metadata.orientation ?? 1) >= 5;
	return {
		format: metadata.format as Format,
		width: swap ? storedHeight : storedWidth,
		height: swap ? storedWidth : storedHeight,
		storedWidth,
		storedHeight,
		orientation: metadata.orientation ?? 1,
		hasAlpha: metadata.hasAlpha ?? false,
		pages: metadata.pages ?? 1,
		byteSize: bytes.length,
	};
}

function options(input: Input, sourceFormat: Format, toolName: string) {
	const definition = TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
	if (!definition) fail("unknown_tool", `Unknown tool: ${toolName}`);
	for (const key of Object.keys(input)) {
		if (!(key in definition.inputSchema.properties))
			fail("invalid_input", `Unsupported parameter: ${key}`);
	}
	if (typeof input.source !== "string" || !input.source.trim())
		fail("invalid_source", "source is required.");
	if (
		input.outputLocation !== undefined &&
		input.outputLocation !== "default" &&
		input.outputLocation !== "source"
	)
		fail("invalid_destination", "outputLocation must be default or source.");
	if (
		input.outputLocation === "source" &&
		input.source.startsWith("attachment:")
	)
		fail("invalid_destination", "Attachments have no source folder.");
	const format = input.format ?? sourceFormat;
	if (!FORMATS.includes(format as Format))
		fail("unsupported_format", "Output must be jpeg, png, or webp.");
	const quality = numeric(input, "quality", 1, 100, 85, true) as number;
	const minQuality = numeric(input, "minQuality", 1, 100, 30, true) as number;
	const targetBytes = numeric(
		input,
		"targetBytes",
		1,
		MAX_BYTES,
		undefined,
		true,
	);
	const lossless = boolean(input, "lossless");
	const compressionLevel = numeric(
		input,
		"compressionLevel",
		0,
		9,
		6,
		true,
	) as number;
	if (format === "png" && targetBytes !== undefined)
		fail(
			"invalid_input",
			"PNG uses lossless compressionLevel; targetBytes requires JPEG or WebP.",
		);
	if (
		lossless &&
		(format !== "webp" ||
			input.quality !== undefined ||
			targetBytes !== undefined)
	)
		fail(
			"invalid_input",
			"lossless requires WebP without quality or targetBytes.",
		);
	if (input.minQuality !== undefined && targetBytes === undefined)
		fail("invalid_input", "minQuality requires targetBytes.");
	if (targetBytes !== undefined && minQuality > quality)
		fail("invalid_input", "minQuality must not exceed quality.");
	const background = input.background ?? "#ffffff";
	if (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background))
		fail("invalid_input", "background must be an opaque #RRGGBB colour.");
	const width = numeric(input, "width", 1, MAX_PIXELS, undefined, true);
	const height = numeric(input, "height", 1, MAX_PIXELS, undefined, true);
	const aspectRatio = numeric(input, "aspectRatio", 0.01, 100);
	if (input.crop !== undefined && aspectRatio !== undefined)
		fail("invalid_crop", "Specify crop or aspectRatio, not both.");
	const rotate = numeric(input, "rotate", 0, 270, 0, true) as number;
	if (![0, 90, 180, 270].includes(rotate))
		fail("invalid_input", "rotate must be 0, 90, 180, or 270.");
	const fit = input.fit ?? "contain";
	if (fit !== "contain" && fit !== "cover")
		fail("invalid_input", "fit must be contain or cover.");
	if (input.fit !== undefined && width === undefined && height === undefined)
		fail("invalid_input", "fit requires resize dimensions.");
	return {
		format: format as Format,
		quality,
		minQuality,
		targetBytes,
		lossless,
		compressionLevel,
		background,
		width,
		height,
		aspectRatio,
		rotate,
		fit,
		enlarge: boolean(input, "enlarge"),
		flipHorizontal: boolean(input, "flipHorizontal"),
		flipVertical: boolean(input, "flipVertical"),
		grayscale: boolean(input, "grayscale"),
		saturation: numeric(input, "saturation", 0, 3, 1) as number,
		brightness: numeric(input, "brightness", 0, 3, 1) as number,
		contrast: numeric(input, "contrast", 0, 3, 1) as number,
	};
}

function cropRectangle(
	input: Input,
	opts: ReturnType<typeof options>,
	width: number,
	height: number,
) {
	if (input.crop !== undefined) {
		const crop = record(input.crop);
		if (
			Object.keys(crop).some(
				(key) => !["left", "top", "width", "height"].includes(key),
			)
		)
			fail("invalid_crop", "Unexpected crop parameter.");
		const left = numeric(crop, "left", 0, width - 1, undefined, true);
		const top = numeric(crop, "top", 0, height - 1, undefined, true);
		const w = numeric(crop, "width", 1, width, undefined, true);
		const h = numeric(crop, "height", 1, height, undefined, true);
		if (
			left === undefined ||
			top === undefined ||
			w === undefined ||
			h === undefined ||
			left + w > width ||
			top + h > height
		)
			fail(
				"invalid_crop",
				"crop requires an in-bounds left, top, width, and height.",
			);
		return { left, top, width: w, height: h };
	}
	if (opts.aspectRatio !== undefined) {
		const w = Math.min(
			width,
			Math.max(1, Math.floor(height * opts.aspectRatio)),
		);
		const h = Math.min(
			height,
			Math.max(1, Math.floor(width / opts.aspectRatio)),
		);
		return {
			left: Math.floor((width - w) / 2),
			top: Math.floor((height - h) / 2),
			width: w,
			height: h,
		};
	}
	return undefined;
}

async function publish(bytes: Buffer, outputPath: string) {
	const directory = path.dirname(outputPath);
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	if ((await fs.lstat(directory)).isSymbolicLink())
		fail("invalid_destination", "Output directory must not be a symlink.");
	const temporary = path.join(directory, `.images-${randomUUID()}.tmp`);
	try {
		await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
		await fs.link(temporary, outputPath); // Atomic publication that never replaces a destination.
	} finally {
		await fs.rm(temporary, { force: true });
	}
}

export async function executeImageTool(
	toolName: string,
	rawInput: Input,
	files: FileContext,
	dryRun: boolean,
) {
	// Strict tool-calling providers express omitted optional fields as null.
	const input = Object.fromEntries(
		Object.entries(rawInput).filter(
			([key, value]) => key === "source" || value !== null,
		),
	);
	const bytes = await readSource(files.source);
	const source = await inspect(bytes);
	if (toolName === "imagesInspect") {
		if (Object.keys(input).some((key) => key !== "source"))
			fail("invalid_input", "Inspection only accepts source.");
		return { result: { ...source, source: input.source }, appliedActions: [] };
	}
	const opts = options(input, source.format, toolName);
	const swap = opts.rotate === 90 || opts.rotate === 270;
	const orientedWidth = swap ? source.height : source.width;
	const orientedHeight = swap ? source.width : source.height;
	const crop = cropRectangle(input, opts, orientedWidth, orientedHeight);
	const baseWidth = crop?.width ?? orientedWidth;
	const baseHeight = crop?.height ?? orientedHeight;
	const boundWidth =
		opts.width ??
		Math.ceil(baseWidth * ((opts.height ?? baseHeight) / baseHeight));
	const boundHeight =
		opts.height ??
		Math.ceil(baseHeight * ((opts.width ?? baseWidth) / baseWidth));
	if (boundWidth * boundHeight > MAX_PIXELS)
		fail("output_too_large", "Requested output exceeds 40 megapixels.");
	const extension = opts.format === "jpeg" ? "jpg" : opts.format;
	const outputName =
		input.outputName ??
		(input.outputLocation === "source"
			? `${path.parse(files.source.filename).name}.${extension}`
			: `${path.parse(files.source.filename).name}-edited-${randomUUID()}.${extension}`);
	if (
		typeof outputName !== "string" ||
		outputName !== path.basename(outputName) ||
		outputName.includes("\\") ||
		[...outputName].some((character) => character.charCodeAt(0) < 32) ||
		!outputName.trim()
	)
		fail(
			"invalid_destination",
			"outputName must be a filename without directories or control characters.",
		);
	const ext = path.extname(outputName).toLowerCase();
	if (
		!(
			opts.format === "jpeg" ? [".jpg", ".jpeg"] : [`.${opts.format}`]
		).includes(ext)
	)
		fail(
			"invalid_destination",
			"outputName extension must match output format.",
		);
	if (!path.isAbsolute(files.outputDir))
		fail(
			"invalid_destination",
			"Core must provide an absolute output directory.",
		);
	const outputPath = path.join(files.outputDir, outputName);
	const existing = await fs.lstat(outputPath).catch((error) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	if (existing)
		fail(
			"destination_exists",
			"Destination already exists; choose another outputName.",
		);
	const edits = { ...input, crop, ...opts };
	if (dryRun)
		return {
			result: { dryRun: true, source: input.source, outputPath, edits },
			appliedActions: [`[DRY RUN] Would write ${outputPath}`],
		};

	// Raw stages guarantee rotate/flip precede crop without intermediate lossy encoding.
	const oriented = await decoder(bytes)
		.autoOrient()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	let geometry = sharp(oriented.data, { raw: oriented.info }).rotate(
		opts.rotate,
	);
	const rotated = await geometry.raw().toBuffer({ resolveWithObject: true });
	geometry = sharp(rotated.data, { raw: rotated.info });
	if (opts.flipHorizontal) geometry = geometry.flop();
	if (opts.flipVertical) geometry = geometry.flip();
	const flipped = await geometry.raw().toBuffer({ resolveWithObject: true });
	let pipeline = sharp(flipped.data, { raw: flipped.info }).timeout({
		seconds: 15,
	});
	if (crop) pipeline = pipeline.extract(crop);
	if (opts.width || opts.height)
		pipeline = pipeline.resize({
			width: opts.width,
			height: opts.height,
			fit: opts.fit as "contain" | "cover",
			withoutEnlargement: !opts.enlarge,
			background: opts.background,
		});
	pipeline = pipeline.modulate({
		saturation: opts.saturation,
		brightness: opts.brightness,
	});
	if (opts.grayscale) pipeline = pipeline.grayscale();
	if (opts.contrast !== 1)
		pipeline = pipeline.linear(opts.contrast, 128 * (1 - opts.contrast));
	if (opts.format === "jpeg")
		pipeline = pipeline.flatten({ background: opts.background });
	const pixels = await pipeline
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const encode = (quality: number) => {
		const image = sharp(pixels.data, { raw: pixels.info }).timeout({
			seconds: 8,
		});
		if (opts.format === "jpeg") return image.jpeg({ quality }).toBuffer();
		if (opts.format === "png")
			return image.png({ compressionLevel: opts.compressionLevel }).toBuffer();
		return image.webp({ quality, lossless: opts.lossless }).toBuffer();
	};
	let quality = opts.quality;
	let output = await encode(quality);
	if (opts.targetBytes !== undefined && output.length > opts.targetBytes) {
		quality = opts.minQuality;
		output = await encode(quality);
		if (output.length <= opts.targetBytes) {
			let low = opts.minQuality + 1;
			let high = opts.quality - 1;
			for (let attempt = 0; low <= high && attempt < 7; attempt++) {
				const candidateQuality = Math.floor((low + high) / 2);
				const candidate = await encode(candidateQuality);
				if (candidate.length <= opts.targetBytes) {
					output = candidate;
					quality = candidateQuality;
					low = candidateQuality + 1;
				} else high = candidateQuality - 1;
			}
		}
	}
	if (output.length > MAX_BYTES)
		fail("output_too_large", "Encoded output exceeds 50 MB.");
	await publish(output, outputPath);
	const fileUrl = pathToFileURL(outputPath).href;
	const label = outputName.replace(/[\\[\]]/g, "\\$&");
	return {
		result: {
			source: input.source,
			path: outputPath,
			fileUrl,
			markdown: `[Download ${label}](${fileUrl})`,
			filename: outputName,
			format: opts.format,
			mediaType: `image/${opts.format}`,
			width: pixels.info.width,
			height: pixels.info.height,
			byteSize: output.length,
			sourceByteSize: bytes.length,
			compressionRatio: bytes.length / output.length,
			quality: opts.format === "png" || opts.lossless ? undefined : quality,
			targetMet:
				opts.targetBytes === undefined
					? undefined
					: output.length <= opts.targetBytes,
			edits,
			warnings:
				source.hasAlpha && opts.format === "jpeg"
					? [`Transparency flattened onto ${opts.background}.`]
					: [],
		},
		appliedActions: [`Created image ${outputPath}`],
	};
}

export async function validateEngine() {
	await sharp({
		create: { width: 1, height: 1, channels: 3, background: "white" },
	})
		.webp()
		.toBuffer();
	return sharp.versions;
}
