import path from "node:path";
import { defineConfig } from "vitest/config";

const coreSrc = path.resolve(__dirname, "../../packages/core/src");

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@toby\/core\/(.*)$/,
				replacement: `${coreSrc}/$1`,
			},
			{
				find: "@toby/core",
				replacement: path.join(coreSrc, "index.ts"),
			},
		],
	},
	test: {
		globals: true,
		pool: "forks",
	},
});
