import path from "node:path";
import { env } from "@huggingface/transformers";
import { resolveTobyDir } from "../config/index";

export function setHuggingFaceCacheDir(): void {
	env.cacheDir = path.join(resolveTobyDir(), "hf-cache");
}
