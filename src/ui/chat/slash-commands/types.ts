export interface SlashCommandRuntime {
	readonly exit: () => void;
	readonly openHelp: () => void;
	readonly openIntegrationPicker: () => void;
	readonly openConfig: () => void;
	readonly openSkills: () => void;
	readonly openPersonaPicker: () => void;
	readonly openPersonaConfigure: (pathKeys: readonly string[]) => void;
	readonly startNewSession: () => void;
	readonly openSessionsPicker: () => void;
	readonly chatIntegrationsCount: number;
	readonly addMetaLine: (text: string) => void;
	readonly getActivePlan: () => import("../../../planning/types").Plan | null;
	readonly skipPlanPhase: (planId: string, phaseId: string) => void;
	readonly cancelPlan: (planId: string) => void;
}

export interface SlashCommand {
	readonly command: `/${string}`;
	readonly description: string;
	readonly helpText: string;
	readonly run: (
		runtime: SlashCommandRuntime,
		rawArgs?: string,
	) => void | Promise<void>;
}
