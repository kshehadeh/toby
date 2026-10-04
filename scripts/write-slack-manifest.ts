import { fileURLToPath } from "node:url";
import { buildSlackManifest } from "../apps/plugin-slack/src/setup";

await Bun.write(
	new URL("../apps/help-site/static/slack-app-manifest.json", import.meta.url),
	`${JSON.stringify(buildSlackManifest(), null, "\t")}\n`,
);

const result = Bun.spawnSync([
	"bunx",
	"biome",
	"format",
	"--write",
	fileURLToPath(
		new URL(
			"../apps/help-site/static/slack-app-manifest.json",
			import.meta.url,
		),
	),
]);
if (result.exitCode !== 0)
	throw new Error("Could not format the generated Slack manifest");
