interface SlashCommandRuntime {
	readonly exit: () => void;
	readonly openHelp: () => void;
	readonly openIntegrationPicker: () => void;
	readonly openConfig: () => void;
	readonly startNewSession: () => void;
	readonly openSessionsPicker: () => void;
	readonly chatIntegrationsCount: number;
	readonly addMetaLine: (text: string) => void;
}

export interface SlashCommand {
	readonly command: `/${string}`;
	readonly description: string;
	readonly helpText: string;
	readonly run: (runtime: SlashCommandRuntime) => void | Promise<void>;
}
