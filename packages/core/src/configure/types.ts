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
	/** Relative URL to a custom icon image (e.g. "/icons/ai/openai.svg"). */
	iconUrl?: string;
	/** Emoji or icon identifier for UI display when no image URL is available. */
	icon?: string;
	/** Optional group label for visual grouping of fields in the configure UI. */
	group?: string;
	/** Short description shown on parent section cards (e.g. AI provider cards). */
	description?: string;
	/** External documentation URL shown as a link on parent section cards. */
	docUrl?: string;
}

export interface ConfigureTreeContext {
	readonly daemonRunning: boolean;
}

export const DEFAULT_CONFIGURE_TREE_CONTEXT: ConfigureTreeContext = {
	daemonRunning: false,
};
