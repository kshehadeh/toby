import fs from "node:fs";
import type { IntegrationModule } from "../types";
import { pluginConfigShape, pluginSetup, pluginSetupGuide } from "./client";
import { discoverPluginBinaries } from "./discovery";
import { resolvePluginInstallTarget } from "./install";
import type {
	PluginConfigField,
	PluginInvocationTarget,
	PluginSetupActionResult,
	PluginSetupGuideResponse,
	PluginSetupGuideStep,
	PluginSetupResponse,
} from "./protocol";
import { resolvePluginTarget } from "./runtime";

export type PluginSetupRunResult =
	| {
			readonly ok: true;
			readonly name: string;
			readonly target: PluginInvocationTarget;
			readonly response: PluginSetupResponse;
	  }
	| {
			readonly ok: false;
			readonly name: string;
			readonly error: string;
			readonly code: string;
	  };

export function pluginSetupHasFailures(response: PluginSetupResponse): boolean {
	if (!response.ok) {
		return true;
	}
	return (response.actions ?? []).some(
		(action) => !action.ok && action.skipped !== true,
	);
}

export function formatPluginSetupActionLines(
	actions: readonly PluginSetupActionResult[],
): string[] {
	return actions.map((action) => {
		const status = action.skipped ? "skipped" : action.ok ? "ok" : "failed";
		const detail = action.detail ? ` — ${action.detail}` : "";
		return `${action.label} [${status}]${detail}`;
	});
}

export function resolveInstalledPluginTarget(
	name: string,
): PluginInvocationTarget | null {
	const normalized = name.trim();
	const discovered = discoverPluginBinaries().find(
		(entry) => entry.binaryName === `toby-plugin-${normalized}`,
	);
	if (discovered) {
		try {
			return resolvePluginTarget(discovered);
		} catch {
			return null;
		}
	}
	const installPath = resolvePluginInstallTarget(normalized);
	return fs.existsSync(installPath)
		? { kind: "binary", executablePath: installPath }
		: null;
}

export function runPluginSetup(name: string): PluginSetupRunResult {
	const normalized = name.trim();
	if (!normalized) {
		return {
			ok: false,
			name: normalized,
			error: "Plugin name is required",
			code: "invalid_name",
		};
	}

	const target = resolveInstalledPluginTarget(normalized);
	if (!target) {
		return {
			ok: false,
			name: normalized,
			error: `Plugin "${normalized}" is not installed`,
			code: "not_installed",
		};
	}

	const result = pluginSetup(target);
	if (!result.ok) {
		return {
			ok: false,
			name: normalized,
			error: result.error,
			code: result.code,
		};
	}

	if (!result.data.ok) {
		return {
			ok: false,
			name: normalized,
			error: result.data.error ?? "Plugin setup returned ok:false",
			code: result.data.code ?? "setup_failed",
		};
	}

	return {
		ok: true,
		name: normalized,
		target,
		response: result.data,
	};
}

export type IntegrationSetupGuideResult =
	| {
			readonly ok: true;
			readonly name: string;
			readonly displayName: string;
			readonly description?: string;
			readonly steps: readonly PluginSetupGuideStep[];
	  }
	| {
			readonly ok: false;
			readonly name: string;
			readonly error: string;
			readonly code: string;
	  };

function buildGenericSetupGuide(
	module: IntegrationModule,
	fields: readonly PluginConfigField[],
	name: string,
	displayName: string,
): IntegrationSetupGuideResult {
	const authMethods = module.authMethods ?? [];
	const defaultAuthMethod =
		authMethods.find((m) => m.isDefault)?.label ??
		authMethods[0]?.label ??
		"OAuth";
	const hasSetupFlow = fields.length > 0 || authMethods.length > 0;

	const credentialLabels = fields
		.filter(
			(f) =>
				f.showForAuthMethods === undefined || f.showForAuthMethods.length === 0,
		)
		.map((f) => f.label);
	const authSpecificFields = authMethods
		.filter((m) => m.id !== "manual")
		.flatMap((method) => {
			const methodFields = fields
				.filter((f) => f.showForAuthMethods?.includes(method.id))
				.map((f) => f.label);
			if (methodFields.length === 0) return [];
			return [`${method.label}: ${methodFields.join(", ")}`];
		});
	const credentialLines =
		credentialLabels.length > 0 ? credentialLabels : authSpecificFields;

	const steps: PluginSetupGuideStep[] = [
		{
			id: "overview",
			title: `What ${displayName} can do`,
			description:
				module.description ??
				`${displayName} integrates with Toby so you can use it in chat and schedules.`,
		},
		{
			id: "credentials",
			title: "Add credentials",
			description: credentialLines.length
				? `Configure these values in the fields below: ${credentialLines.join("; ")}.`
				: `No credentials are required for ${displayName}.`,
		},
	];

	if (hasSetupFlow) {
		steps.push({
			id: "auth",
			title: "Authorize Toby",
			description:
				authMethods.length > 1
					? `Choose an auth method (default: ${defaultAuthMethod}), then click Connect to sign in.`
					: `Click Connect to sign in with ${defaultAuthMethod}.`,
		});
	}

	steps.push({
		id: "validate",
		title: "Validate the connection",
		description:
			"Toby will run a health check to confirm the integration is ready to use.",
	});

	return {
		ok: true,
		name,
		displayName,
		description: module.description,
		steps,
	};
}

export function buildIntegrationSetupGuide(
	module: IntegrationModule,
): IntegrationSetupGuideResult {
	const name = module.name;
	const displayName = module.displayName;
	const target = resolveInstalledPluginTarget(name);

	if (target) {
		const result = pluginSetupGuide(target);
		if (
			result.ok &&
			result.data.ok &&
			result.data.steps &&
			result.data.steps.length > 0
		) {
			return {
				ok: true,
				name: result.data.name ?? name,
				displayName: result.data.displayName ?? displayName,
				description: result.data.description ?? module.description,
				steps: result.data.steps,
			};
		}
	}

	const shapeResult = target ? pluginConfigShape(target) : null;
	const fields =
		shapeResult?.ok && shapeResult.data.ok && shapeResult.data.fields
			? shapeResult.data.fields
			: [];

	return buildGenericSetupGuide(module, fields, name, displayName);
}
