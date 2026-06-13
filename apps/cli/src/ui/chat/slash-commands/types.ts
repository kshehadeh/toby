import type { LaunchContext } from "../../../toby-launch-context";

export type UpgradeUiStatus =
	| { readonly status: "idle" }
	| {
			readonly status: "downloading";
			readonly tag?: string;
			readonly progress: number | null;
	  }
	| {
			readonly status: "extracting";
			readonly tag?: string;
	  }
	| {
			readonly status: "verifying";
			readonly tag?: string;
	  }
	| { readonly status: "ready"; readonly version: string }
	| { readonly status: "error"; readonly message: string };

export interface SlashCommandRuntime {
	readonly exit: () => void;
	readonly openHelp: () => void;
	readonly openUsageViewer: () => void;
	readonly openLogViewer: () => void;
	readonly openTerminalViewer: () => void;
	readonly openTextViewer: (
		title: string,
		lines: readonly string[],
		options?: { readonly lineTone?: "default" | "markdown" },
	) => void;
	readonly openIntegrationPicker: () => void;
	readonly openConfig: () => void;
	readonly openSkills: () => void;
	readonly openSchedules: () => void;
	readonly openPersonaPicker: () => void;
	readonly openPersonaConfigure: (pathKeys: readonly string[]) => void;
	readonly openProjectPicker: () => void;
	readonly openProjectConfigure: (slug: string) => void;
	readonly startNewSession: () => void;
	readonly openSessionsPicker: () => void;
	readonly chatIntegrationsCount: number;
	readonly launchContext: LaunchContext;
	readonly addMetaLine: (text: string) => void;
	readonly addNoticeLine: (
		text: string,
		tone?: "info" | "success" | "error",
	) => void;
	readonly updateProgressNotice: (
		text: string,
		tone?: "info" | "success" | "error",
	) => void | Promise<void>;
	readonly addUserContextMessage: (text: string) => void;
	readonly setUpgradeStatus?: (status: UpgradeUiStatus) => void;
	readonly getActivePlan: () => import("@toby/core/planning/types").Plan | null;
	readonly skipPlanPhase: (planId: string, phaseId: string) => void;
	readonly cancelPlan: (planId: string) => void;
	readonly startListenRecording: () => void;
	readonly stopListenRecording: (action: "save" | "discard") => Promise<{
		readonly outputDir: string;
		readonly transcript?: string;
		readonly transcriptionError?: string;
	} | null>;
	readonly isListenRecording: () => boolean;
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
