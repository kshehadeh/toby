export const embedVectorByText = new Map<string, number[]>();

function hashVector(text: string): number[] {
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
	}
	const a = (h & 0xff) / 255;
	const b = ((h >> 8) & 0xff) / 255;
	const c = ((h >> 16) & 0xff) / 255;
	const n = Math.sqrt(a * a + b * b + c * c) || 1;
	return [a / n, b / n, c / n];
}

export function vectorForEmbedText(text: string): number[] {
	return embedVectorByText.get(text) ?? hashVector(text);
}

export async function stubEmbedTexts(params: {
	readonly model?: unknown;
	readonly values: readonly string[];
}): Promise<number[][]> {
	return params.values.map((text) => vectorForEmbedText(text));
}
