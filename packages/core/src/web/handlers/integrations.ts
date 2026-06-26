import { getIntegrationModule } from "../../integrations/index";
import { targetDisplayPath } from "../../integrations/plugins/protocol";
import { getPluginMetadata } from "../../integrations/plugins/registry";
import {
	buildIntegrationSetupGuide,
	resolveInstalledPluginTarget,
	runPluginSetup,
} from "../../integrations/plugins/setup";
import { errorResponse, jsonResponse } from "../http-utils";

export async function handleIntegrationStatus(name: string): Promise<Response> {
	const module = getIntegrationModule(name);
	if (!module) {
		return errorResponse("Integration not found", 404);
	}

	const [connected, pluginTarget, health] = await Promise.all([
		module.isConnected(),
		Promise.resolve(resolveInstalledPluginTarget(name)),
		module.testConnection({ validateTools: true }),
	]);

	const pluginPath = pluginTarget ? targetDisplayPath(pluginTarget) : null;

	const metadata = getPluginMetadata(name);
	const supportsSetup = metadata?.setupAvailable ?? false;
	const setupDescription = metadata?.setupDescription;

	return jsonResponse({
		name: module.name,
		displayName: module.displayName,
		description: module.description,
		connected,
		pluginPath,
		supportsSetup,
		setupDescription,
		authMethods: module.authMethods ?? [],
		health,
	});
}

export async function handleIntegrationConnect(
	name: string,
): Promise<Response> {
	const module = getIntegrationModule(name);
	if (!module) {
		return errorResponse("Integration not found", 404);
	}
	try {
		await module.connect();
		return jsonResponse({ ok: true });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 500);
	}
}

export async function handleIntegrationDisconnect(
	name: string,
): Promise<Response> {
	const module = getIntegrationModule(name);
	if (!module) {
		return errorResponse("Integration not found", 404);
	}
	try {
		await module.disconnect();
		return jsonResponse({ ok: true });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 500);
	}
}

export async function handleIntegrationReauthorize(
	name: string,
): Promise<Response> {
	const module = getIntegrationModule(name);
	if (!module) {
		return errorResponse("Integration not found", 404);
	}
	try {
		await module.disconnect();
		await module.connect();
		return jsonResponse({ ok: true });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 500);
	}
}

export async function handleIntegrationSetup(name: string): Promise<Response> {
	const module = getIntegrationModule(name);
	if (!module) {
		return errorResponse("Integration not found", 404);
	}
	try {
		const result = runPluginSetup(name);
		if (!result.ok) {
			return errorResponse(result.error, 500);
		}
		return jsonResponse({ ok: true, response: result.response });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 500);
	}
}

export async function handleIntegrationSetupGuide(
	name: string,
): Promise<Response> {
	const module = getIntegrationModule(name);
	if (!module) {
		return errorResponse("Integration not found", 404);
	}
	try {
		const result = buildIntegrationSetupGuide(module);
		if (!result.ok) {
			return errorResponse(result.error, 500);
		}
		return jsonResponse({
			ok: true,
			name: result.name,
			displayName: result.displayName,
			description: result.description,
			steps: result.steps,
		});
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 500);
	}
}
