/** Parse `- name: description` lines from pretreatment tool/skill catalogs. */
export function parseCatalogLines(
	catalogText: string,
): ReadonlyArray<{ readonly id: string; readonly text: string }> {
	if (!catalogText.trim() || catalogText.trim() === "(none)") {
		return [];
	}
	const out: { id: string; text: string }[] = [];
	for (const line of catalogText.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("- ")) {
			continue;
		}
		const body = trimmed.slice(2);
		const colon = body.indexOf(":");
		if (colon <= 0) {
			continue;
		}
		const id = body.slice(0, colon).trim();
		const rest = body.slice(colon + 1).trim();
		if (!id) {
			continue;
		}
		out.push({ id, text: `${id}: ${rest}` });
	}
	return out;
}
