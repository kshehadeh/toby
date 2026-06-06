import open from "open";

export async function openWebUiInBrowser(url: string): Promise<boolean> {
	try {
		await open(url);
		return true;
	} catch {
		return false;
	}
}
