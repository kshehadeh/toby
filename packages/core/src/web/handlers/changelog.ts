import { fetchChangelog } from "../../releases/changelog";
import { parseIntParam } from "../http-utils";

export async function handleChangelog(url: URL): Promise<Response> {
	const limit = parseIntParam(url.searchParams.get("limit"), 10, 10);
	try {
		const changelog = await fetchChangelog({ limit });
		return new Response(JSON.stringify(changelog), {
			status: 200,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return new Response(JSON.stringify({ error: message }), {
			status: 502,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}
}
