/**
 * Remove unpaired UTF-16 surrogate code units from a string.
 *
 * Truncating text with `String.prototype.slice` counts UTF-16 code units, so it
 * can cut an astral-plane character (e.g. an emoji) between its high and low
 * surrogate, leaving a lone surrogate behind. Lone surrogates serialize to
 * `\uXXXX` escapes that strict JSON parsers — notably Foundation's
 * `JSONDecoder` used by the macOS app — reject as malformed, which fails
 * decoding of the entire transcript payload.
 */
export function stripLoneSurrogates(value: string): string {
	let result = "";
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				result += value[i] + value[i + 1];
				i++;
			}
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			continue;
		}
		result += value[i];
	}
	return result;
}
