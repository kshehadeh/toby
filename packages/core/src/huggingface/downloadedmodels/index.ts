import { ModelRegistry } from "@huggingface/transformers";
import chalk from "chalk";
import { readConfig, writeConfig } from "../../config/index";

export function getDownloadedModels(): string[] {
	return readConfig().huggingFaceSelfHostedModels ?? [];
}

export function addDownloadedModel(model: string): void {
	const trimmed = model.trim();
	if (!trimmed) return;
	const config = readConfig();
	const models = config.huggingFaceSelfHostedModels ?? [];
	if (models.includes(trimmed)) return;
	config.huggingFaceSelfHostedModels = [...models, trimmed];
	writeConfig(config);
}

export async function removeDownloadedModel(model: string): Promise<void> {
	try {
		await ModelRegistry.clear_cache(model);
	} catch (error) {
		console.error(chalk.red(error));
	}
	const config = readConfig();
	config.huggingFaceSelfHostedModels = (
		config.huggingFaceSelfHostedModels ?? []
	).filter((m) => m !== model);
	writeConfig(config);
}

export function getInferenceModels(): string[] {
	return readConfig().huggingFaceInferenceModels ?? [];
}

export function addInferenceModel(model: string): void {
	const trimmed = model.trim();
	if (!trimmed) return;
	const config = readConfig();
	const models = config.huggingFaceInferenceModels ?? [];
	if (models.includes(trimmed)) return;
	config.huggingFaceInferenceModels = [...models, trimmed];
	writeConfig(config);
}

export function removeInferenceModel(model: string): void {
	const config = readConfig();
	config.huggingFaceInferenceModels = (
		config.huggingFaceInferenceModels ?? []
	).filter((m) => m !== model);
	writeConfig(config);
}
