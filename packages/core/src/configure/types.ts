export type ItemKind =
	| "section"
	| "value"
	| "action"
	| "select"
	| "multiSelect"
	| "delete"
	| "hint"
	| "image";

/** Action items shown in the configure left tree when their parent section is expanded. */
export const CONFIGURE_TREE_ACTION_KEYS = new Set([
	"personas._new",
	"projects._new",
	"listen._start",
	"schedules._new",
]);

/** Sentinel model-select value that triggers the "add custom model" editor. */
export const ADD_CUSTOM_MODEL_SENTINEL = "__add_custom_model__";

export interface SettingsSelectChoice {
	readonly value: string;
	readonly label: string;
}

export interface SettingsItem {
	label: string;
	kind: ItemKind;
	/** Storage key in configure values (and config on save). */
	key: string;
	/** Unique navigation row id; defaults to `key`. */
	navKey?: string;
	children?: SettingsItem[];
	masked?: boolean;
	multiline?: boolean;
	/** Plain option values (label matches value). */
	options?: string[];
	/** Labeled options for select fields (value stored, label shown). */
	selectChoices?: SettingsSelectChoice[];
	currentValue?: string;
	/** Currently selected values for multiSelect fields. */
	selectedValues?: readonly string[];
	/** When true, field is read-only in the web UI (credentials). */
	readOnly?: boolean;
}

export interface ConfigureListenRecording {
	readonly id: string;
	readonly dir: string;
	readonly metadata: {
		readonly name?: string;
		readonly description?: string;
		readonly startedAt?: string;
		readonly createdAt: string;
		readonly durationMs?: number;
		readonly sources: { readonly mic?: boolean; readonly system?: boolean };
	};
}

export interface ConfigureTreeContext {
	readonly listenRecordingsDir?: string;
	readonly listenRecordings: readonly ConfigureListenRecording[];
	readonly daemonRunning: boolean;
	readonly formatListenSources: (sources: {
		readonly mic?: boolean;
		readonly system?: boolean;
	}) => string;
}

export const DEFAULT_CONFIGURE_TREE_CONTEXT: ConfigureTreeContext = {
	listenRecordings: [],
	daemonRunning: false,
	formatListenSources: (sources) => {
		const parts: string[] = [];
		if (sources.mic) parts.push("Mic");
		if (sources.system) parts.push("System");
		return parts.length > 0 ? parts.join(", ") : "None";
	},
};
