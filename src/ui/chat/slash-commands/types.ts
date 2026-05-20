import type { LaunchContext } from "../../../toby-launch-context";

export type UpgradeUiStatus =
	| { readonly status: "idle" }
	| {
			readonly status: "downloading";
			readonly tag?: string;
			readonly progress: number | null;
	  }
	| { readonly status: "ready"; readonly version: string }
	| { readonly status: "error"; readonly message: string };

export interface SlashCommandRuntime {
	readonly exit: () => void;
	readonly openHelp: () => void;
	readonly openIntegrationPicker: () => void;
	readonly openConfig: () => void;
	readonly openSkills: () => void;
	readonly openSchedules: () => void;
	readonly openPersonaPicker: () => void;
	readonly openPersonaConfigure: (pathKeys: readonly string[]) => void;
	readonly startNewSession: () => void;
	readonly openSessionsPicker: () => void;
	readonly chatIntegrationsCount: number;
	readonly launchContext: LaunchContext;
	readonly addMetaLine: (text: string) => void;
	readonly setUpgradeStatus?: (status: UpgradeUiStatus) => void;
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
