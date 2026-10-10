const number = (description: string, minimum: number, maximum: number) => ({
	type: "number",
	description,
	minimum,
	maximum,
});
const integer = (description: string, minimum: number, maximum: number) => ({
	...number(description, minimum, maximum),
	type: "integer",
});
const common = {
	source: {
		type: "string",
		description:
			"attachment:<exact filename> for a current-turn image, a project-relative path in project chat, or an absolute local file path outside projects. Never a URL.",
	},
	outputName: {
		type: "string",
		description:
			"Optional new filename only (no directories). With outputLocation source, defaults to the source basename with the new extension; otherwise an auto-generated filename. Existing files cannot be overwritten.",
	},
	outputLocation: {
		type: "string",
		enum: ["default", "source"],
		description:
			"default saves to project outputs or Toby generated-files. source saves beside the local input file; use for same-folder requests. Not available for attachments.",
	},
	format: {
		type: "string",
		enum: ["jpeg", "png", "webp"],
		description: "Output format; defaults to input format.",
	},
	quality: integer(
		"JPEG/WebP encoding quality; 85 default. Ignored for PNG. Does not restore lost detail.",
		1,
		100,
	),
	lossless: {
		type: "boolean",
		description:
			"Lossless WebP only; incompatible with quality and targetBytes.",
	},
	compressionLevel: integer(
		"PNG compression level (not visual quality); 6 default. Ignored for JPEG/WebP.",
		0,
		9,
	),
	background: {
		type: "string",
		description:
			"Opaque #RRGGBB background for JPEG transparency or contain padding; white default.",
	},
};
const transforms = {
	crop: {
		type: "object",
		properties: {
			left: integer("Left pixel after orientation/rotation/flip", 0, 40000000),
			top: integer("Top pixel after orientation/rotation/flip", 0, 40000000),
			width: integer("Crop width", 1, 40000000),
			height: integer("Crop height", 1, 40000000),
		},
		required: ["left", "top", "width", "height"],
		additionalProperties: false,
	},
	aspectRatio: number(
		"Centre-crop width/height ratio; mutually exclusive with crop",
		0.01,
		100,
	),
	width: integer("Resize width", 1, 40000000),
	height: integer("Resize height", 1, 40000000),
	fit: {
		type: "string",
		enum: ["contain", "cover"],
		description: "Resize fit; contain default. Cover crops centrally.",
	},
	enlarge: {
		type: "boolean",
		description: "Allow enlargement; false default.",
	},
	rotate: {
		type: "integer",
		enum: [0, 90, 180, 270],
		description: "Clockwise rotation after EXIF orientation",
	},
	flipHorizontal: { type: "boolean" },
	flipVertical: { type: "boolean" },
	saturation: number("Saturation multiplier; 1 unchanged, 0 grayscale", 0, 3),
	brightness: number("Brightness multiplier; 1 unchanged", 0, 3),
	contrast: number("Contrast multiplier about midpoint 128; 1 unchanged", 0, 3),
	grayscale: { type: "boolean" },
};
const compression = {
	targetBytes: integer(
		"Try to meet this byte limit without resizing; reports targetMet=false if impossible",
		1,
		50 * 1024 * 1024,
	),
	minQuality: integer("Minimum target-search quality; 30 default", 1, 100),
};
function definition(
	name: string,
	displayName: string,
	description: string,
	properties: Record<string, unknown>,
	readOnly = false,
) {
	return {
		name,
		displayName,
		description,
		readOnly,
		fileAccess: true,
		inputSchema: {
			type: "object",
			properties: Object.fromEntries(
				Object.entries(properties).map(([key, value]) => {
					if (key === "source") return [key, value];
					const schema = value as Record<string, unknown>;
					return [
						key,
						{
							...schema,
							type: [schema.type, "null"],
							...(Array.isArray(schema.enum)
								? { enum: [...schema.enum, null] }
								: {}),
						},
					];
				}),
			),
			required: ["source"],
			additionalProperties: false,
		},
	};
}
export const TOOL_DEFINITIONS = [
	definition(
		"imagesInspect",
		"Inspect image",
		"Inspect a local or attached still JPEG, PNG, or WebP: oriented dimensions, stored dimensions, format, alpha, size, and orientation.",
		{ source: common.source },
		true,
	),
	definition(
		"imagesTransform",
		"Transform image",
		"Edit an image locally: EXIF orientation, rotate, flip, crop, resize, colour adjustments, then one encode. Preserves original and strips GPS/descriptive metadata. Crop coordinates follow orientation/rotation/flip. Can combine edits with targetBytes compression.",
		{ ...common, ...transforms, ...compression },
	),
	definition(
		"imagesConvert",
		"Convert image",
		"Convert a still image to JPEG, PNG, or WebP, preserving the original. JPEG flattens transparency onto background (white default).",
		common,
	),
	definition(
		"imagesCompress",
		"Compress image",
		"Re-encode JPEG/WebP at a quality or bounded byte-size target. PNG supports lossless compressionLevel, not quality/targetBytes. Does not resize or improve lost detail.",
		{ ...common, ...compression },
	),
];
