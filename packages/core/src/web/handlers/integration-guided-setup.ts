import { requestChatInboundReload } from "../../chat-inbound/supervisor";
import { readConfig, writeConfig } from "../../config/index";
import { invalidateSettingsCache } from "../../configure/settings-cache";
import {
	buildPluginEnvelope,
	mergePluginConfigPatch,
} from "../../integrations/plugins/adapter";
import {
	pluginConfigShape,
	pluginSetupValidateAsync,
} from "../../integrations/plugins/client";
import { resolveInstalledPluginTarget } from "../../integrations/plugins/setup";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

const pending = new Map<string, AbortController>();

export function handleIntegrationSetupCancel(name: string): Response {
	pending.get(name)?.abort();
	return jsonResponse({ ok: true });
}

export function handleIntegrationSetupState(name: string): Response {
	if (!resolveInstalledPluginTarget(name))
		return errorResponse("Plugin not installed", 404);
	const envelope = buildPluginEnvelope(name);
	const config = readConfig();
	return jsonResponse({
		ok: true,
		configuredFields: Object.entries(envelope.config ?? {})
			.filter(([, value]) => typeof value === "string" && value.trim())
			.map(([key]) => key),
		teamName: envelope.config?.teamName ?? null,
		activeIntegration: config.chatInbound?.enabled
			? config.chatInbound.integration
			: null,
		persona: config.chatInbound?.persona ?? "",
	});
}

/** Validate candidate credentials in the plugin, then persist only a successful stage. */
export async function handleIntegrationGuidedSetup(
	name: string,
	req: Request,
): Promise<Response> {
	const target = resolveInstalledPluginTarget(name);
	if (!target) return errorResponse("Plugin not installed", 404);
	const body = await readJsonBody<{
		fields?: unknown;
		stage?: unknown;
		inbound?: unknown;
	}>(req);
	if (
		!body ||
		!body.fields ||
		typeof body.fields !== "object" ||
		Array.isArray(body.fields) ||
		typeof body.stage !== "string" ||
		typeof body.inbound !== "boolean"
	)
		return errorResponse("Expected fields, stage and inbound.", 400);
	if (pending.has(name))
		return errorResponse("Setup is already running for this integration.", 409);
	const shape = pluginConfigShape(target);
	if (!shape.ok || !shape.data.ok)
		return errorResponse("Unable to load plugin fields.", 400);
	const allowed = new Set((shape.data.fields ?? []).map((field) => field.key));
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(body.fields)) {
		if (
			!allowed.has(key) ||
			typeof value !== "string" ||
			value.includes("••••") ||
			value.length > 4096
		)
			return errorResponse("Invalid setup field.", 400);
		if (value.trim()) fields[key] = value.trim();
	}
	const controller = new AbortController();
	pending.set(name, controller);
	const signal = AbortSignal.any([controller.signal, req.signal]);
	try {
		const config = { ...buildPluginEnvelope(name).config, ...fields };
		const result = await pluginSetupValidateAsync(
			target,
			config,
			{ stage: body.stage, inbound: body.inbound },
			{ signal },
		);
		if (!result.ok)
			return errorResponse(
				result.code === "cancelled"
					? "Setup cancelled"
					: "Plugin setup failed or timed out. Update the plugin and try again.",
				400,
			);
		if (!result.data.ok)
			return errorResponse(
				result.data.error ?? "Setup validation failed.",
				400,
			);
		if (signal.aborted) return errorResponse("Setup cancelled", 400);
		mergePluginConfigPatch(name, { ...fields, ...result.data.config });
		const saved = readConfig();
		saved.integrations[name] = {
			...saved.integrations[name],
			connectedAt: new Date().toISOString(),
		};
		saved.connections = {
			...saved.connections,
			[name]: {
				...saved.connections?.[name],
				type: name,
				displayName: saved.connections?.[name]?.displayName ?? name,
				connectedAt: saved.integrations[name].connectedAt as string,
			},
		};
		writeConfig(saved);
		invalidateSettingsCache();
		requestChatInboundReload();
		return jsonResponse({ ok: true, details: result.data.details ?? {} });
	} finally {
		pending.delete(name);
	}
}
