/** Semantic embedding routing is on by default; set `TOBY_SEMANTIC_ROUTING=0` for legacy LLM pretreatment. */
export function isSemanticRoutingEnabled(): boolean {
	return process.env.TOBY_SEMANTIC_ROUTING !== "0";
}
