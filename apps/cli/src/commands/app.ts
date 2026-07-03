import chalk from "chalk";
import type { Command } from "commander";
import {
	type ResolvedTobyApp,
	launchTobyApp,
	resolveTobyAppPath,
} from "../toby-app-launcher";

export function launchNativeApp(section?: string): {
	readonly ok: boolean;
	readonly message: string;
	readonly resolved?: ResolvedTobyApp;
} {
	const resolved = resolveTobyAppPath();
	if (!resolved) {
		const target = section ? ` for ${section}` : "";
		return {
			ok: false,
			message: `Toby.app was not found${target}. Install the native app or set TOBY_APP to its path.`,
		};
	}
	const result = launchTobyApp(resolved);
	const sectionHint = section ? ` Open ${section} in the native app.` : "";
	return {
		ok: result.ok,
		message: `${result.message}${sectionHint}`,
		resolved,
	};
}

export function runAppLaunchCommand(section?: string): void {
	const result = launchNativeApp(section);
	if (result.ok) {
		console.log(chalk.green(result.message));
		return;
	}
	console.error(chalk.red(result.message));
	process.exitCode = 1;
}

export function registerAppCommand(program: Command): void {
	program
		.command("app")
		.description("Open the native Toby app")
		.action(() => {
			runAppLaunchCommand();
		});
}
