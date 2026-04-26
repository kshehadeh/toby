import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli.ts"],
	format: ["esm"],
	target: "node20",
	external: ["bun:sqlite"],
	banner: { js: "#!/usr/bin/env node" },
	clean: true,
	splitting: false,
	sourcemap: true,
	charset: "utf8",
	esbuildOptions(options) {
		options.jsx = "automatic";
		options.charset = "utf8";
	},
});
