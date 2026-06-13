import { normalizeModelOnProviderChange } from "@toby/core/ai/model-factory";
import { DEFAULT_CHAT_PERSONA } from "@toby/core/personas/index";
import { Box, Text, render, useApp, useInput } from "ink";
import React, {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { humanToCronAsync, isValidCronExpression } from "../../schedules/cron";
import { listScheduleRuns, listSchedules } from "../../schedules/store";
import type { ScheduleRun } from "../../schedules/types";
import {
	ConfirmDialog,
	DetailPaneTitle,
	FieldEditor,
	FieldMultiSelector,
	FieldSelector,
	SelectableTextRow,
	TwoPaneView,
	UI_GLYPHS,
	detectTerminalProfile,
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isQuitKey,
	isSaveKey,
	isSelectKey,
	isToggleKey,
	resolveKittyKeyboardMode,
	useTerminalLayout,
	useTwoPaneNavigation,
} from "../shared";
import { scrollOffsetForSelection } from "../shared/field-selector-logic";
import { ConfigureDetailPane } from "./configure-detail-pane";
import {
	ADD_CUSTOM_MODEL_SENTINEL,
	CONFIGURE_TREE_ACTION_KEYS,
	type SettingsItem,
} from "./items";
import { ListenRecordingView, ListenStartPane } from "./listen-panes";
import { parseListenRecordingIdFromKey } from "./listen-values";
import { ScheduleRunOutputView } from "./schedule-run-output";
import {
	type ListenSectionOptions,
	useListenController,
} from "./use-listen-controller";

type Screen = "nav" | "edit" | "select" | "multiSelect";

const DEFAULT_LISTEN_OPTIONS: ListenSectionOptions = {
	sources: { mic: true, system: true },
};

function parseCommaList(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

interface AppCallbacks {
	onCreatePersona: () => string;
	onDeletePersona: (name: string) => void;
	onSetDefaultPersona: (name: string) => void;
	onClearDefaultPersona: () => void;
	onUpdateSkillField: (
		dirName: string,
		field: "name" | "description" | "summary",
		value: string,
	) => void;
	onOpenSkillInEditor: (dirName: string) => void;
	onDeleteSkill: (dirName: string) => void;
	onUpdateRecordingField: (
		recordingId: string,
		field: "name" | "description",
		value: string,
	) => void;
	onOpenRecordingInFinder: (recordingId: string) => void;
	onDeleteRecording: (recordingId: string) => void;
	onCreateSchedule: () => string;
	onUpdateScheduleField: (
		scheduleId: string,
		field: "name" | "prompt" | "personaName" | "cronExpression" | "enabled",
		value: string | boolean,
	) => void;
	onDeleteSchedule: (scheduleId: string) => void;
	onRunScheduleNow: (scheduleId: string) => Promise<void>;
	onCreateProject: () => string;
	onDeleteProject: (slug: string) => void;
}

interface AppProps {
	root: SettingsItem;
	credentialValues: Record<string, string>;
	onSave: (values: Record<string, string>) => void;
	refreshTree: (values: Record<string, string>) => SettingsItem;
	callbacks: AppCallbacks;
	onQuitRequested?: (values: Record<string, string>) => void;
	initialPath?: readonly string[];
	initialSelectedIndex?: number;
	initialEditorItemKey?: string;
	listenOptions?: ListenSectionOptions;
}

interface FlatTreeNode {
	item: SettingsItem;
	depth: number;
}

/** Flatten section nodes (and tree actions) for the left pane, respecting expansion. */
function flattenTreeSections(
	root: SettingsItem,
	expandedKeys: Set<string>,
): FlatTreeNode[] {
	const result: FlatTreeNode[] = [];

	function walk(node: SettingsItem, depth: number) {
		if (node.kind !== "section") return;
		result.push({ item: node, depth });
		if (expandedKeys.has(node.key) && node.children) {
			for (const child of node.children) {
				if (
					child.kind === "action" &&
					CONFIGURE_TREE_ACTION_KEYS.has(child.key)
				) {
					result.push({ item: child, depth: depth + 1 });
				} else {
					walk(child, depth + 1);
				}
			}
		}
	}

	if (root.children) {
		for (const child of root.children) {
			walk(child, 0);
		}
	}

	return result;
}

/** Find ancestor section keys that must be expanded for `targetKey` to be visible. */
function findAncestorKeys(root: SettingsItem, targetKey: string): string[] {
	const ancestors: string[] = [];

	function search(node: SettingsItem): boolean {
		if (node.key === targetKey) return true;
		if (node.children) {
			for (const child of node.children) {
				if (search(child)) {
					if (node.kind === "section" && node.key !== "root") {
						ancestors.push(node.key);
					}
					return true;
				}
			}
		}
		return false;
	}

	search(root);
	return ancestors;
}

function findSettingsItemByKey(
	root: SettingsItem,
	targetKey: string,
): SettingsItem | null {
	if (root.key === targetKey) return root;
	if (root.children) {
		for (const child of root.children) {
			const found = findSettingsItemByKey(child, targetKey);
			if (found) return found;
		}
	}
	return null;
}

function sectionHasSubCategories(node: SettingsItem | null): boolean {
	return node?.children?.some((c) => c.kind === "section") ?? false;
}

/** Find the index of the parent node in the flattened tree. */
function findParentIndex(
	flatNodes: FlatTreeNode[],
	currentIndex: number,
): number {
	const currentDepth = flatNodes[currentIndex]?.depth ?? 0;
	for (let i = currentIndex - 1; i >= 0; i--) {
		if (flatNodes[i].depth < currentDepth) return i;
	}
	return -1;
}

function paneIndexForRightNav(
	rightNavItems: { readonly item: SettingsItem }[],
	rightPaneItems: { readonly item: SettingsItem }[],
	navIndex: number,
): number {
	const navItem = rightNavItems[navIndex];
	if (!navItem) {
		return 0;
	}
	const key = navItem.item.navKey ?? navItem.item.key;
	const idx = rightPaneItems.findIndex(
		(field) => (field.item.navKey ?? field.item.key) === key,
	);
	return idx >= 0 ? idx : navIndex;
}

export function ConfigureApp({
	root,
	credentialValues,
	onSave,
	refreshTree,
	callbacks,
	onQuitRequested,
	initialPath,
	initialSelectedIndex = 0,
	initialEditorItemKey,
	listenOptions = DEFAULT_LISTEN_OPTIONS,
}: AppProps) {
	const { exit } = useApp();
	const [tree, setTree] = useState(root);
	const [screen, setScreen] = useState<Screen>("nav");
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [editItem, setEditItem] = useState<SettingsItem | null>(null);
	const [values, setValues] =
		useState<Record<string, string>>(credentialValues);
	const [savedValues, setSavedValues] =
		useState<Record<string, string>>(credentialValues);
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);
	const [scheduleRunView, setScheduleRunView] = useState<{
		readonly run: ScheduleRun;
		readonly scheduleName: string;
	} | null>(null);

	// ── Flatten tree for left pane ──────────────────────────────────────
	const { frameHeight } = useTerminalLayout();
	const flatNodes = useMemo(
		() => flattenTreeSections(tree, expandedKeys),
		[tree, expandedKeys],
	);

	// Auto-reset is disabled because the right index must also reset when the
	// selected node changes without `leftIndex` changing (e.g. tree refresh).
	const {
		focusedPane,
		setFocusedPane,
		leftIndex,
		setLeftIndex,
		rightIndex,
		setRightIndex,
		toggleFocus,
	} = useTwoPaneNavigation({
		leftCount: flatNodes.length,
		resetRightOnLeftChange: false,
	});

	const selectedNode = flatNodes[leftIndex]?.item ?? null;

	// A "branch" node has section children (sub-categories) and uses expand/collapse.
	// A "leaf" node has no section children — only fields — and acts like a sub-item.
	const selectedHasSubCategories =
		selectedNode?.children?.some((c) => c.kind === "section") ?? false;

	// ── Build right pane items ──────────────────────────────────────────
	// Branch nodes with sub-categories hide the right pane until a sub-item is selected.
	// Leaf nodes and sub-items always show their fields.
	const rightPaneItems = useMemo(() => {
		if (!selectedNode || selectedHasSubCategories) return [];
		const children = selectedNode.children ?? [];
		return children.map((item) => {
			const rawValue =
				item.kind === "value" ||
				item.kind === "select" ||
				item.kind === "multiSelect"
					? (values[item.key] ?? item.currentValue)
					: undefined;
			let displayValue = rawValue;
			if (item.kind === "multiSelect" && rawValue !== undefined) {
				displayValue = rawValue || "(none)";
			} else if (item.kind === "select" && rawValue !== undefined) {
				const labeled = item.selectChoices?.find((c) => c.value === rawValue);
				displayValue = labeled?.label ?? rawValue;
			}
			return {
				item,
				key: item.navKey ?? item.key,
				label: item.label,
				kind: item.kind,
				masked: item.masked,
				multiline: item.multiline,
				options: item.options,
				selectChoices: item.selectChoices,
				selectedValues: item.selectedValues,
				currentValue: displayValue,
			};
		});
	}, [selectedNode, selectedHasSubCategories, values]);

	const rightNavItems = useMemo(
		() => rightPaneItems.filter((item) => item.kind !== "hint"),
		[rightPaneItems],
	);

	const selectedRightNavKey =
		rightNavItems[rightIndex]?.item.navKey ??
		rightNavItems[rightIndex]?.item.key ??
		null;

	const isListenStartSelected = selectedNode?.key === "listen._start";
	const hasRightPaneContent =
		rightPaneItems.length > 0 || isListenStartSelected;

	const [rightScrollOffset, setRightScrollOffset] = useState(0);

	// Approximate rows available in the right pane (full-frame height minus chrome).
	const rightVisibleLines = Math.max(3, frameHeight - 11);

	const scrollRightPaneToNavIndex = useCallback(
		(navIndex: number) => {
			const paneIdx = paneIndexForRightNav(
				rightNavItems,
				rightPaneItems,
				navIndex,
			);
			setRightScrollOffset((offset) =>
				scrollOffsetForSelection(
					paneIdx,
					offset,
					rightVisibleLines,
					rightPaneItems.length,
				),
			);
		},
		[rightNavItems, rightPaneItems, rightVisibleLines],
	);

	useLayoutEffect(() => {
		scrollRightPaneToNavIndex(rightIndex);
	}, [rightIndex, scrollRightPaneToNavIndex]);

	const visibleRightPaneItems = useMemo(
		() =>
			rightPaneItems.slice(
				rightScrollOffset,
				rightScrollOffset + rightVisibleLines,
			),
		[rightPaneItems, rightScrollOffset, rightVisibleLines],
	);

	// ── Initial navigation from external (e.g. chat /persona) ──────────
	const initialNavigateRef = useRef({
		path: initialPath,
		index: initialSelectedIndex,
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: one-shot init — expandedKeys intentionally excluded to avoid re-triggering
	useLayoutEffect(() => {
		const spec = initialNavigateRef.current;
		if (!spec.path?.length) return;

		const targetKey = spec.path[spec.path.length - 1];
		const targetNode = findSettingsItemByKey(tree, targetKey);
		const hasSubCategories = sectionHasSubCategories(targetNode);
		const ancestorKeys = findAncestorKeys(tree, targetKey);
		const newExpanded = new Set(expandedKeys);
		for (const key of ancestorKeys) newExpanded.add(key);
		if (hasSubCategories) {
			newExpanded.add(targetKey);
		}

		const newFlat = flattenTreeSections(tree, newExpanded);
		const idx = newFlat.findIndex((n) => n.item.key === targetKey);

		setExpandedKeys(newExpanded);
		if (idx >= 0) {
			setLeftIndex(idx);
			setFocusedPane(hasSubCategories ? "left" : "right");
			setRightIndex(0);
		}

		initialNavigateRef.current = {
			path: undefined,
			index: 0,
		};
	}, [tree, setLeftIndex, setFocusedPane, setRightIndex]);

	// ── Initial editor key ──────────────────────────────────────────────
	const initialEditorKeyRef = useRef(initialEditorItemKey);
	// biome-ignore lint/correctness/useExhaustiveDependencies: one-shot init — values read only for multiSelect init
	useLayoutEffect(() => {
		const key = initialEditorKeyRef.current;
		if (!key || !selectedNode) return;

		const child = selectedNode.children?.find(
			(c) => c.key === key || c.navKey === key,
		);
		if (!child) return;

		initialEditorKeyRef.current = undefined;
		if (child.kind === "value") {
			setEditItem(child);
			setScreen("edit");
		} else if (child.kind === "select") {
			setEditItem(child);
			setScreen("select");
		} else if (child.kind === "multiSelect") {
			setEditItem({
				...child,
				selectedValues: parseCommaList(
					values[child.key] ?? child.currentValue ?? "",
				),
			});
			setScreen("multiSelect");
		}
	}, [selectedNode]);

	// ── Reset right index when left selection changes ───────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useLayoutEffect(() => {
		setRightIndex(0);
		setRightScrollOffset(0);
	}, [leftIndex, selectedNode]);

	// ── Dirty detection ─────────────────────────────────────────────────
	const isDirty = Object.keys(values).some(
		(key) =>
			!key.startsWith("skills.") &&
			!key.startsWith("listen.recordings.") &&
			!key.startsWith("schedules.") &&
			values[key] !== savedValues[key],
	);

	// ── Tree refresh (returns new tree for immediate use) ───────────────
	const doRefresh = useCallback(
		(newValues: Record<string, string>): SettingsItem => {
			const newTree = refreshTree(newValues);
			setTree(newTree);
			return newTree;
		},
		[refreshTree],
	);

	const onRecordingsChanged = useCallback(
		(newValues: Record<string, string>) => {
			setValues(newValues);
			doRefresh(newValues);
		},
		[doRefresh],
	);

	const listen = useListenController(
		listenOptions,
		onRecordingsChanged,
		values,
	);

	// ── Exit ─────────────────────────────────────────────────────────────
	const doExit = useCallback(() => {
		if (onQuitRequested) {
			onQuitRequested(values);
			return;
		}
		onSave(values);
		exit();
	}, [values, onSave, exit, onQuitRequested]);

	// ── Save ─────────────────────────────────────────────────────────────
	const handleSave = useCallback(() => {
		onSave(values);
		setSavedValues(values);
		setStatusMessage("Configuration saved.");
	}, [values, onSave]);

	// ── Navigate to a section in the left tree ───────────────────────────
	const navigateToSection = useCallback(
		(sectionKey: string, focusRightPane = true) => {
			const ancestorKeys = findAncestorKeys(tree, sectionKey);
			const newExpanded = new Set(expandedKeys);
			for (const key of ancestorKeys) newExpanded.add(key);

			const newFlat = flattenTreeSections(tree, newExpanded);
			const idx = newFlat.findIndex((n) => n.item.key === sectionKey);

			setExpandedKeys(newExpanded);
			if (idx >= 0) setLeftIndex(idx);
			if (focusRightPane) setFocusedPane("right");
		},
		[tree, expandedKeys, setLeftIndex, setFocusedPane],
	);

	// ── Create persona ──────────────────────────────────────────────────
	const handleCreatePersona = useCallback(() => {
		const personaName = callbacks.onCreatePersona();
		const defaults = DEFAULT_CHAT_PERSONA;
		const newValues = {
			...values,
			[`personas.${personaName}.name`]: personaName,
			[`personas.${personaName}.instructions`]: defaults.instructions,
			[`personas.${personaName}.promptMode`]: defaults.promptMode,
			[`personas.${personaName}.ai.provider`]: defaults.ai.provider,
			[`personas.${personaName}.ai.model`]: defaults.ai.model,
		};
		setValues(newValues);
		const newTree = doRefresh(newValues);

		const ancestorKeys = findAncestorKeys(newTree, `personas.${personaName}`);
		const newExpanded = new Set(expandedKeys);
		newExpanded.add("personas");
		for (const key of ancestorKeys) newExpanded.add(key);
		const newFlat = flattenTreeSections(newTree, newExpanded);
		const idx = newFlat.findIndex(
			(n) => n.item.key === `personas.${personaName}`,
		);
		setExpandedKeys(newExpanded);
		if (idx >= 0) setLeftIndex(idx);
		setFocusedPane("right");
		setRightIndex(0);
		setStatusMessage(undefined);
	}, [
		values,
		doRefresh,
		callbacks,
		expandedKeys,
		setLeftIndex,
		setFocusedPane,
		setRightIndex,
	]);

	// ── Create project ──────────────────────────────────────────────────
	const handleCreateProject = useCallback(() => {
		const slug = callbacks.onCreateProject();
		const newValues = {
			...values,
			[`projects.${slug}.name`]: "Project",
			[`projects.${slug}.skills`]: "",
			[`projects.${slug}.integrations`]: "",
		};
		setValues(newValues);
		setSavedValues(newValues);
		const newTree = doRefresh(newValues);

		const ancestorKeys = findAncestorKeys(newTree, `projects.${slug}`);
		const newExpanded = new Set(expandedKeys);
		newExpanded.add("projects");
		for (const key of ancestorKeys) newExpanded.add(key);
		const newFlat = flattenTreeSections(newTree, newExpanded);
		const idx = newFlat.findIndex((n) => n.item.key === `projects.${slug}`);
		setExpandedKeys(newExpanded);
		if (idx >= 0) setLeftIndex(idx);
		setFocusedPane("right");
		setRightIndex(0);
		setStatusMessage(undefined);
	}, [
		values,
		doRefresh,
		callbacks,
		expandedKeys,
		setLeftIndex,
		setFocusedPane,
		setRightIndex,
	]);

	// ── Handle item activation in right pane ────────────────────────────
	const handleSelectItem = useCallback(
		(item: SettingsItem) => {
			setStatusMessage(undefined);

			if (item.kind === "section") {
				navigateToSection(item.key);
				return;
			}

			if (item.kind === "hint") {
				return;
			}

			if (item.kind === "value") {
				setEditItem(item);
				setScreen("edit");
			} else if (item.kind === "select") {
				setEditItem(item);
				setScreen("select");
			} else if (item.kind === "multiSelect") {
				setEditItem({
					...item,
					selectedValues: parseCommaList(
						values[item.key] ?? item.currentValue ?? "",
					),
				});
				setScreen("multiSelect");
			} else if (item.kind === "action") {
				if (item.key === "schedules._new") {
					const scheduleId = callbacks.onCreateSchedule();
					doRefresh(values);

					const sectionKey = `schedules.${scheduleId}`;
					const newExpanded = new Set(expandedKeys);
					newExpanded.add("schedules");
					const ancestorKeys = findAncestorKeys(tree, sectionKey);
					for (const key of ancestorKeys) newExpanded.add(key);

					const newFlat = flattenTreeSections(tree, newExpanded);
					const idx = newFlat.findIndex((n) => n.item.key === sectionKey);

					setExpandedKeys(newExpanded);
					if (idx >= 0) setLeftIndex(idx);
					setFocusedPane("right");
					setRightIndex(0);
					return;
				}
				if (item.key === "listen._start") {
					listen.startListening();
					setFocusedPane("right");
					setRightIndex(0);
					return;
				}
				if (item.key === "personas._new") {
					handleCreatePersona();
				} else if (item.key === "projects._new") {
					handleCreateProject();
				} else if (
					item.key.endsWith("._edit") &&
					item.key.startsWith("skills.")
				) {
					const dirName = item.key
						.replace(/^skills\./, "")
						.replace(/\._edit$/, "");
					try {
						callbacks.onOpenSkillInEditor(dirName);
						setStatusMessage("Opened in editor.");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to open editor.",
						);
					}
				} else if (item.key.endsWith("._setDefault")) {
					const personaName = item.key
						.replace("personas.", "")
						.replace("._setDefault", "");
					if (item.label === "★ Default persona") {
						callbacks.onClearDefaultPersona();
						setStatusMessage("Default persona cleared.");
					} else {
						callbacks.onSetDefaultPersona(personaName);
						setStatusMessage(`"${personaName}" set as default persona.`);
					}
					doRefresh(values);
				} else if (
					item.key.startsWith("listen.recordings.") &&
					item.key.endsWith("._open")
				) {
					const recordingId = parseListenRecordingIdFromKey(item.key);
					if (!recordingId) return;
					try {
						callbacks.onOpenRecordingInFinder(recordingId);
						setStatusMessage("Opened in Finder.");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to open Finder.",
						);
					}
				} else if (
					item.key.startsWith("schedules.") &&
					item.key.endsWith("._run")
				) {
					const scheduleId = item.key
						.replace(/^schedules\./, "")
						.replace(/\._run$/, "");
					void (async () => {
						try {
							setStatusMessage("Running schedule…");
							await callbacks.onRunScheduleNow(scheduleId);
							doRefresh(values);
							setStatusMessage(undefined);
						} catch (e) {
							setStatusMessage(
								`Run failed: ${e instanceof Error ? e.message : String(e)}`,
							);
						}
					})();
					return;
				} else if (
					item.key.startsWith("schedules.") &&
					item.key.includes(".runs.")
				) {
					const match = /^schedules\.(.+)\.runs\.(.+)$/.exec(item.key);
					if (!match) return;
					const [, scheduleId, runId] = match;
					const scheduleName =
						values[`schedules.${scheduleId}.name`] ??
						listSchedules().find((s) => s.id === scheduleId)?.name ??
						scheduleId;
					let run: ScheduleRun | null = null;
					try {
						run =
							listScheduleRuns(scheduleId, 50).find((r) => r.id === runId) ??
							null;
					} catch {
						run = null;
					}
					if (!run) return;
					setScheduleRunView({ run, scheduleName });
					return;
				}
			} else if (item.kind === "delete") {
				if (
					item.key.startsWith("schedules.") &&
					item.key.endsWith("._delete")
				) {
					const scheduleId = item.key
						.replace(/^schedules\./, "")
						.replace(/\._delete$/, "");
					const scheduleName =
						values[`schedules.${scheduleId}.name`] ?? scheduleId;
					setConfirmMsg(`Delete schedule "${scheduleName}"?`);
					setConfirmAction(() => () => {
						try {
							callbacks.onDeleteSchedule(scheduleId);
							const cleanedValues: Record<string, string> = { ...values };
							for (const key of Object.keys(cleanedValues)) {
								if (key.startsWith(`schedules.${scheduleId}.`)) {
									delete cleanedValues[key];
								}
							}
							setValues(cleanedValues);
							doRefresh(cleanedValues);
							setFocusedPane("left");
							setStatusMessage(undefined);
						} catch (e) {
							setStatusMessage(
								e instanceof Error ? e.message : "Failed to delete schedule.",
							);
						}
					});
					return;
				}
				if (
					item.key.startsWith("listen.recordings.") &&
					item.key.endsWith("._delete")
				) {
					const recordingId = parseListenRecordingIdFromKey(item.key);
					if (!recordingId) return;
					const recordingName =
						values[`listen.recordings.${recordingId}.name`] || recordingId;
					setConfirmMsg(`Delete recording "${recordingName}"?`);
					setConfirmAction(() => () => {
						try {
							callbacks.onDeleteRecording(recordingId);
							const cleanedValues = { ...values };
							for (const key of Object.keys(cleanedValues)) {
								if (key.startsWith(`listen.recordings.${recordingId}.`)) {
									delete cleanedValues[key];
								}
							}
							setValues(cleanedValues);
							doRefresh(cleanedValues);
							setFocusedPane("left");
							setStatusMessage(undefined);
						} catch (e) {
							setStatusMessage(
								e instanceof Error ? e.message : "Failed to delete recording.",
							);
						}
					});
					return;
				}
				if (item.key.startsWith("skills.") && item.key.endsWith("._delete")) {
					const dirName = item.key
						.replace(/^skills\./, "")
						.replace(/\._delete$/, "");
					const skillName = values[`skills.${dirName}.name`] ?? dirName;
					setConfirmMsg(`Delete skill "${skillName}"?`);
					setConfirmAction(() => () => {
						try {
							callbacks.onDeleteSkill(dirName);
							const cleanedValues: Record<string, string> = {};
							const deletedPrefix = `skills.${dirName}.`;
							for (const [key, value] of Object.entries(values)) {
								if (!key.startsWith(deletedPrefix)) {
									cleanedValues[key] = value;
								}
							}
							setValues(cleanedValues);
							setSavedValues(cleanedValues);
							doRefresh(cleanedValues);
							setFocusedPane("left");
							setStatusMessage(undefined);
						} catch (e) {
							setStatusMessage(
								e instanceof Error ? e.message : "Failed to delete skill.",
							);
						}
					});
					return;
				}
				const personaName = item.key
					.replace("personas.", "")
					.replace("._delete", "");
				setConfirmMsg(`Delete persona "${personaName}"?`);
				setConfirmAction(() => () => {
					callbacks.onDeletePersona(personaName);
					const cleanedValues: Record<string, string> = {};
					const deletedPrefix = `personas.${personaName}.`;
					for (const [key, value] of Object.entries(values)) {
						if (!key.startsWith(deletedPrefix)) {
							cleanedValues[key] = value;
						}
					}
					setValues(cleanedValues);
					doRefresh(cleanedValues);
				});
			} else if (
				item.key.startsWith("projects.") &&
				item.key.endsWith("._delete")
			) {
				const slug = item.key
					.replace(/^projects\./, "")
					.replace(/\._delete$/, "");
				const projectName = values[`projects.${slug}.name`] ?? slug;
				setConfirmMsg(`Delete project "${projectName}"?`);
				setConfirmAction(() => () => {
					callbacks.onDeleteProject(slug);
					const cleanedValues: Record<string, string> = {};
					const deletedPrefix = `projects.${slug}.`;
					for (const [key, value] of Object.entries(values)) {
						if (!key.startsWith(deletedPrefix)) {
							cleanedValues[key] = value;
						}
					}
					setValues(cleanedValues);
					doRefresh(cleanedValues);
				});
			}
		},
		[
			values,
			doRefresh,
			callbacks,
			expandedKeys,
			tree,
			navigateToSection,
			handleCreatePersona,
			handleCreateProject,
			setLeftIndex,
			setFocusedPane,
			setRightIndex,
			listen,
		],
	);

	// ── Editor submit ───────────────────────────────────────────────────
	const handleEditorSubmit = useCallback(
		(newValue: string) => {
			if (editItem) {
				const scheduleFieldMatch = /^schedules\.(.+)\.(name|prompt|cron)$/.exec(
					editItem.key,
				);
				if (scheduleFieldMatch) {
					const [, scheduleId, field] = scheduleFieldMatch;
					setScreen("nav");
					setEditItem(null);

					if (field === "cron") {
						void (async () => {
							try {
								setStatusMessage("Converting schedule expression…");
								const cronExpr = await humanToCronAsync(newValue);
								if (!isValidCronExpression(cronExpr)) {
									setStatusMessage("Invalid cron expression.");
									return;
								}
								callbacks.onUpdateScheduleField(
									scheduleId,
									"cronExpression",
									cronExpr,
								);
								const newValues = { ...values, [editItem.key]: cronExpr };
								setValues(newValues);
								doRefresh(newValues);
								setStatusMessage("Schedule updated.");
							} catch {
								setStatusMessage(
									'Invalid schedule expression. Try a cron format like "0 9 * * *" or natural language like "every weekday at 9am".',
								);
							}
						})();
						return;
					}

					try {
						callbacks.onUpdateScheduleField(
							scheduleId,
							field === "name" ? "name" : "prompt",
							newValue,
						);
						const newValues = { ...values, [editItem.key]: newValue };
						setValues(newValues);
						doRefresh(newValues);
						setStatusMessage("Schedule updated.");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to update schedule.",
						);
					}
					return;
				}

				const listenFieldMatch =
					/^listen\.recordings\.(.+)\.(name|description)$/.exec(editItem.key);
				if (listenFieldMatch) {
					const [, recordingId, field] = listenFieldMatch;
					try {
						callbacks.onUpdateRecordingField(
							recordingId,
							field as "name" | "description",
							newValue,
						);
						const newValues = { ...values, [editItem.key]: newValue };
						setValues(newValues);
						doRefresh(newValues);
						setStatusMessage("Recording updated.");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to update recording.",
						);
					}
					setScreen("nav");
					setEditItem(null);
					return;
				}

				const skillFieldMatch =
					/^skills\.(.+)\.(name|description|summary)$/.exec(editItem.key);
				if (skillFieldMatch) {
					const [, dirName, field] = skillFieldMatch;
					try {
						callbacks.onUpdateSkillField(
							dirName,
							field as "name" | "description" | "summary",
							newValue,
						);
						const newValues = { ...values, [editItem.key]: newValue };
						setValues(newValues);
						setSavedValues(newValues);
						doRefresh(newValues);
						setStatusMessage("Skill updated.");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to update skill.",
						);
					}
					setScreen("nav");
					setEditItem(null);
					return;
				}

				let newValues = { ...values, [editItem.key]: newValue };
				const personaNameKeyMatch = /^personas\.(.+)\.name$/.exec(editItem.key);

				if (personaNameKeyMatch) {
					const oldName = personaNameKeyMatch[1];
					const newName = newValue;
					if (newName && newName !== oldName) {
						const existingNames = new Set(
							Object.keys(values)
								.filter(
									(key) => key.startsWith("personas.") && key.endsWith(".name"),
								)
								.map((key) => values[key]),
						);
						existingNames.delete(oldName);

						if (existingNames.has(newName)) {
							setStatusMessage(
								`Persona "${newName}" already exists. Choose a different name.`,
							);
							setScreen("nav");
							setEditItem(null);
							return;
						}

						const oldPrefix = `personas.${oldName}.`;
						const migratedValues: Record<string, string> = { ...newValues };

						for (const [key, value] of Object.entries(newValues)) {
							if (!key.startsWith(oldPrefix)) continue;
							const suffix = key.slice(oldPrefix.length);
							delete migratedValues[key];
							migratedValues[`personas.${newName}.${suffix}`] = value;
						}

						migratedValues[`personas.${newName}.name`] = newName;
						newValues = migratedValues;
					}
				}

				setValues(newValues);
				doRefresh(newValues);
			}

			// When the user typed a custom model name via the add-custom sentinel
			// flow, also append it to the provider's saved custom model list so it
			// appears in future selector sessions.
			if (editItem) {
				const modelMatch = /^personas\.(.+)\.ai\.model$/.exec(editItem.key);
				if (modelMatch && newValue.trim()) {
					const personaName = modelMatch[1];
					const providerId = values[`personas.${personaName}.ai.provider`];
					if (providerId) {
						const customModelsKey = `ai.customModels.${providerId}`;
						const existing = (values[customModelsKey] ?? "")
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						const trimmed = newValue.trim();
						if (!existing.includes(trimmed)) {
							const updated = [...existing, trimmed].join("\n");
							const newValues = { ...values, [customModelsKey]: updated };
							setValues(newValues);
							doRefresh(newValues);
						}
					}
				}
			}

			setStatusMessage(undefined);
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, values, doRefresh, callbacks],
	);

	// ── Select submit ────────────────────────────────────────────────────
	const handleSelectSubmit = useCallback(
		(newValue: string) => {
			if (editItem) {
				// Selecting "+ Add custom model…" opens a text editor to capture a new
				// model name instead of storing the sentinel as the model value.
				if (
					newValue === ADD_CUSTOM_MODEL_SENTINEL &&
					/^personas\.(.+)\.ai\.model$/.test(editItem.key)
				) {
					setEditItem({ ...editItem, currentValue: "" });
					setScreen("edit");
					return;
				}

				let newValues = { ...values, [editItem.key]: newValue };

				const scheduleSelectMatch = /^schedules\.(.+)\.(enabled|persona)$/.exec(
					editItem.key,
				);
				if (scheduleSelectMatch) {
					const [, scheduleId, field] = scheduleSelectMatch;
					try {
						if (field === "enabled") {
							callbacks.onUpdateScheduleField(
								scheduleId,
								"enabled",
								newValue === "Yes",
							);
						} else {
							callbacks.onUpdateScheduleField(
								scheduleId,
								"personaName",
								newValue,
							);
						}
						setValues(newValues);
						doRefresh(newValues);
						setStatusMessage("Schedule updated.");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to update schedule.",
						);
					}
					setScreen("nav");
					setEditItem(null);
					return;
				}

				const providerChangeMatch = /^personas\.(.+)\.ai\.provider$/.exec(
					editItem.key,
				);
				if (providerChangeMatch) {
					const personaName = providerChangeMatch[1];
					const modelKey = `personas.${personaName}.ai.model`;
					const previousModel = values[modelKey] ?? "";
					newValues = {
						...newValues,
						[modelKey]: normalizeModelOnProviderChange(newValue, previousModel),
					};
				}
				setValues(newValues);
				doRefresh(newValues);
			}
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, values, doRefresh, callbacks],
	);

	// ── Multi-select submit ────────────────────────────────────────────
	const handleMultiSelectSubmit = useCallback(
		(newSelectedValues: string[]) => {
			if (editItem) {
				const joined = newSelectedValues.join(", ");
				const newValues = { ...values, [editItem.key]: joined };
				setValues(newValues);
				doRefresh(newValues);
			}
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, values, doRefresh],
	);

	// ── Editor cancel ───────────────────────────────────────────────────
	const handleEditorCancel = useCallback(() => {
		setScreen("nav");
		setEditItem(null);
	}, []);

	// ── Input handling ──────────────────────────────────────────────────
	useInput((input, key) => {
		if (scheduleRunView) return;
		if (listen.listenConfirm || screen !== "nav" || confirmAction) return;

		if (listen.state.status === "listening" && input === "s") {
			void listen.finalize("save");
			return;
		}
		if (listen.state.status === "listening" && input === "d") {
			listen.setListenConfirm("discard");
			return;
		}

		// Global: save from any pane
		if (isSaveKey(input, key)) {
			handleSave();
			return;
		}

		// Global: quit
		if (isQuitKey(input, key)) {
			if (listen.isRecording) {
				listen.setListenConfirm("quit");
				return;
			}
			if (isDirty) {
				setConfirmMsg("Discard unsaved changes?");
				setConfirmAction(() => () => {
					setConfirmAction(null);
					setConfirmMsg("");
					setValues(savedValues);
					doRefresh(savedValues);
					doExit();
				});
				return;
			}
			doExit();
			return;
		}

		// Tab switches panes
		if (key.tab && !listen.isRecording) {
			toggleFocus(hasRightPaneContent);
			return;
		}

		// ── Left pane: tree navigation ──────────────────────────────────
		if (focusedPane === "left") {
			if (isNavigateUp(input, key)) {
				setLeftIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (isNavigateDown(input, key)) {
				setLeftIndex((prev) => Math.min(flatNodes.length - 1, prev + 1));
				return;
			}
			if (key.rightArrow) {
				const node = flatNodes[leftIndex]?.item;
				if (!node) return;
				const hasSubCats =
					node.children?.some((c) => c.kind === "section") ?? false;
				if (hasSubCats) {
					if (!expandedKeys.has(node.key)) {
						// Expand collapsed branch
						setExpandedKeys((prev) => {
							const next = new Set(prev);
							next.add(node.key);
							return next;
						});
					} else if (
						leftIndex + 1 < flatNodes.length &&
						flatNodes[leftIndex + 1].depth > flatNodes[leftIndex].depth
					) {
						// Move to first child
						setLeftIndex(leftIndex + 1);
					}
				} else if (hasRightPaneContent) {
					// Leaf node: focus right pane
					setFocusedPane("right");
					setRightIndex(0);
				}
				return;
			}
			if (key.leftArrow) {
				const node = flatNodes[leftIndex]?.item;
				if (!node) return;
				const hasSubCats =
					node.children?.some((c) => c.kind === "section") ?? false;
				if (hasSubCats && expandedKeys.has(node.key)) {
					// Collapse expanded branch
					setExpandedKeys((prev) => {
						const next = new Set(prev);
						next.delete(node.key);
						return next;
					});
				} else {
					// Move to parent
					const parentIdx = findParentIndex(flatNodes, leftIndex);
					if (parentIdx >= 0) setLeftIndex(parentIdx);
				}
				return;
			}
			if (isSelectKey(input, key)) {
				const node = flatNodes[leftIndex]?.item;
				if (
					node?.kind === "action" &&
					CONFIGURE_TREE_ACTION_KEYS.has(node.key)
				) {
					handleSelectItem(node);
					return;
				}
				// Branch nodes (with sub-categories): Enter toggles expand/collapse.
				// Leaf nodes (fields only): Enter focuses the right pane to edit.
				if (selectedHasSubCategories) {
					const node = flatNodes[leftIndex]?.item;
					if (!node) return;
					setExpandedKeys((prev) => {
						const next = new Set(prev);
						if (next.has(node.key)) {
							next.delete(node.key);
						} else {
							next.add(node.key);
						}
						return next;
					});
				} else if (hasRightPaneContent) {
					setFocusedPane("right");
					setRightIndex(0);
				}
				return;
			}
			if (isBackKey(input, key)) {
				if (isDirty) {
					setConfirmMsg("Discard unsaved changes?");
					setConfirmAction(() => () => {
						setConfirmAction(null);
						setConfirmMsg("");
						setValues(savedValues);
						doRefresh(savedValues);
						doExit();
					});
					return;
				}
				doExit();
				return;
			}
			return;
		}

		// ── Right pane: field navigation ─────────────────────────────────
		const listenRightMaxIndex = listen.isRecording ? 1 : 1;
		const rightMaxIndex = isListenStartSelected
			? listenRightMaxIndex
			: Math.max(0, rightNavItems.length - 1);

		if (isListenStartSelected && listen.isRecording) {
			if (isNavigateUp(input, key)) {
				setRightIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (isNavigateDown(input, key)) {
				setRightIndex((prev) => Math.min(listenRightMaxIndex, prev + 1));
				return;
			}
			if (isSelectKey(input, key)) {
				if (rightIndex === 0) void listen.finalize("save");
				else listen.setListenConfirm("discard");
				return;
			}
			return;
		}

		if (isListenStartSelected && !listen.isRecording) {
			if (isNavigateUp(input, key)) {
				setRightIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (isNavigateDown(input, key)) {
				setRightIndex((prev) => Math.min(1, prev + 1));
				return;
			}
			if (isSelectKey(input, key) || isToggleKey(input, key)) {
				if (rightIndex === 0) listen.toggleMic();
				else listen.toggleSystem();
				return;
			}
			if (isBackKey(input, key)) {
				setFocusedPane("left");
				return;
			}
			return;
		}

		if (isNavigateUp(input, key)) {
			const next = Math.max(0, rightIndex - 1);
			setRightIndex(next);
			scrollRightPaneToNavIndex(next);
			return;
		}
		if (isNavigateDown(input, key)) {
			const next = Math.min(rightMaxIndex, rightIndex + 1);
			setRightIndex(next);
			scrollRightPaneToNavIndex(next);
			return;
		}
		if (isSelectKey(input, key)) {
			const rightItem = rightNavItems[rightIndex];
			if (rightItem) {
				handleSelectItem(rightItem.item);
			}
			return;
		}
		if (isBackKey(input, key)) {
			setFocusedPane("left");
			return;
		}
	});

	// ── Schedule run output overlay ─────────────────────────────────────
	if (scheduleRunView) {
		return (
			<ScheduleRunOutputView
				run={scheduleRunView.run}
				scheduleName={scheduleRunView.scheduleName}
				onBack={() => setScheduleRunView(null)}
			/>
		);
	}

	// ── Editor overlay ──────────────────────────────────────────────────
	if (screen === "edit" && editItem) {
		const resolvedValue = values[editItem.key] ?? editItem.currentValue;
		const itemWithCurrent = { ...editItem, currentValue: resolvedValue };

		return (
			<FieldEditor
				appTitle="Configuration"
				fieldLabel={itemWithCurrent.label}
				value={itemWithCurrent.currentValue ?? ""}
				multiline={itemWithCurrent.multiline}
				masked={itemWithCurrent.masked}
				onSubmit={handleEditorSubmit}
				onCancel={handleEditorCancel}
			/>
		);
	}

	// ── Select overlay ───────────────────────────────────────────────────
	if (screen === "select" && editItem) {
		return (
			<FieldSelector
				appTitle="Configuration"
				fieldLabel={editItem.label}
				choices={editItem.selectChoices}
				options={editItem.options ?? []}
				currentValue={values[editItem.key] ?? editItem.currentValue}
				onSubmit={handleSelectSubmit}
				onCancel={handleEditorCancel}
			/>
		);
	}

	// ── Multi-select overlay ────────────────────────────────────────────
	if (screen === "multiSelect" && editItem) {
		return (
			<FieldMultiSelector
				appTitle="Configuration"
				fieldLabel={editItem.label}
				choices={editItem.selectChoices}
				options={editItem.options ?? []}
				selectedValues={editItem.selectedValues ?? []}
				onSubmit={handleMultiSelectSubmit}
				onCancel={handleEditorCancel}
			/>
		);
	}

	// ── Main 2-pane layout ──────────────────────────────────────────────
	const rightScrollHint =
		rightPaneItems.length > rightVisibleLines
			? ` · fields ${rightScrollOffset + 1}-${Math.min(
					rightScrollOffset + rightVisibleLines,
					rightPaneItems.length,
				)}/${rightPaneItems.length}`
			: "";

	const footerText =
		focusedPane === "left"
			? "↑↓ navigate · → expand · ← collapse · Enter open · s save · q close"
			: `↑↓ navigate · Enter edit · s save · Tab/Esc tree · q close${rightScrollHint}`;

	const leftPane = (
		<>
			<DetailPaneTitle
				title="Config Categories"
				active={focusedPane === "left"}
			/>
			{flatNodes.map((node, i) => {
				const isSelected = i === leftIndex;
				const isActive = focusedPane === "left";
				const isExpanded = expandedKeys.has(node.item.key);
				const hasSubCats =
					node.item.kind === "section" &&
					(node.item.children?.some((c) => c.kind === "section") ?? false);
				const indent = "  ".repeat(node.depth);
				const expandGlyph = hasSubCats ? (isExpanded ? "▾" : "▸") : " ";

				if (node.item.kind === "action") {
					const isListenStart = node.item.key === "listen._start";
					const actionLabel =
						isListenStart && listen.isRecording
							? "Recording…"
							: node.item.label;
					const actionColor =
						isListenStart && listen.isRecording ? "red" : "green";
					return (
						<SelectableTextRow
							key={node.item.key}
							selected={isSelected && isActive}
							dim={isSelected && !isActive}
							color={actionColor}
						>
							{indent}
							{UI_GLYPHS.action} {actionLabel}
						</SelectableTextRow>
					);
				}

				return (
					<SelectableTextRow
						key={node.item.key}
						selected={isSelected && isActive}
						dim={isSelected && !isActive}
					>
						{indent}
						{expandGlyph} {node.item.label}
					</SelectableTextRow>
				);
			})}
			{flatNodes.length === 0 ? (
				<Box paddingX={1}>
					<Text dimColor>No configuration categories.</Text>
				</Box>
			) : null}
		</>
	);

	const rightPaneTitle = isListenStartSelected
		? listen.isRecording
			? "Recording"
			: "Start new recording"
		: (selectedNode?.label ?? "");

	const rightPane =
		selectedNode && !selectedHasSubCategories ? (
			<>
				<DetailPaneTitle
					title={rightPaneTitle}
					active={focusedPane === "right"}
				/>
				{isListenStartSelected ? (
					listen.isRecording ? (
						<ListenRecordingView
							state={listen.state}
							elapsed={listen.elapsed}
							focusIndex={rightIndex}
						/>
					) : (
						<ListenStartPane
							sources={listen.state.sources}
							focusIndex={rightIndex}
						/>
					)
				) : rightPaneItems.length === 0 ? (
					<Box paddingX={1}>
						<Text dimColor>
							{selectedNode.key === "personas._new"
								? "Press Enter to create a new persona."
								: selectedNode.children?.some((c) => c.kind === "section")
									? "Expand this category to select a sub-category."
									: "No fields in this section."}
						</Text>
					</Box>
				) : (
					<ConfigureDetailPane
						fields={visibleRightPaneItems}
						selectedKey={selectedRightNavKey}
						paneActive={focusedPane === "right"}
					/>
				)}
			</>
		) : (
			<Box paddingX={1}>
				<Text dimColor>Select a category on the left.</Text>
			</Box>
		);

	const listenConfirmMsg =
		listen.listenConfirm === "discard"
			? "Discard the current recording?"
			: listen.listenConfirm === "quit"
				? "Stop and discard the active recording before quitting?"
				: listen.pendingDeleteRecording
					? `Delete recording ${listen.pendingDeleteRecording.id}?`
					: "";

	const confirmOverlay =
		confirmAction && confirmMsg ? (
			<ConfirmDialog
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
					setConfirmAction(null);
					setConfirmMsg("");
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
				}}
			/>
		) : listen.listenConfirm ? (
			<ConfirmDialog
				message={listenConfirmMsg}
				onConfirm={() => listen.handleListenConfirm(doExit)}
				onCancel={() => listen.setListenConfirm(null)}
			/>
		) : null;

	const listenIdleMessageHidden =
		listen.state.status === "idle" &&
		listen.state.message === "Ready to record audio.";

	const activeStatusMessage =
		statusMessage ??
		listen.listenStatusMessage ??
		(listenIdleMessageHidden ? undefined : listen.state.message);

	return (
		<TwoPaneView
			title="Configuration"
			leftMaxWidth={100}
			statusBar={<Text dimColor>{footerText}</Text>}
			focusedPane={focusedPane}
			left={leftPane}
			right={rightPane}
			overlay={confirmOverlay}
			status={
				activeStatusMessage && !confirmAction && !listen.listenConfirm ? (
					<Box paddingX={1} marginTop={1}>
						<Text
							color={
								listen.state.status === "saved" &&
								activeStatusMessage === listen.state.message
									? "green"
									: "yellow"
							}
						>
							{listen.state.status === "saved" &&
							activeStatusMessage === listen.state.message
								? `${UI_GLYPHS.success} ${activeStatusMessage}`
								: activeStatusMessage}
						</Text>
					</Box>
				) : null
			}
		/>
	);
}

export interface ConfigureUIOptions {
	readonly initialPath?: readonly string[];
	readonly initialSelectedIndex?: number;
	readonly initialEditorItemKey?: string;
	readonly listenOptions?: ListenSectionOptions;
}

export function runConfigureUI(
	root: SettingsItem,
	credentialValues: Record<string, string>,
	onSave: (values: Record<string, string>) => void,
	refreshTree: (values: Record<string, string>) => SettingsItem,
	callbacks: AppCallbacks,
	options: ConfigureUIOptions = {},
): void {
	const profile = detectTerminalProfile();
	render(
		<ConfigureApp
			root={root}
			credentialValues={credentialValues}
			onSave={onSave}
			refreshTree={refreshTree}
			callbacks={callbacks}
			initialPath={options.initialPath}
			initialSelectedIndex={options.initialSelectedIndex}
			initialEditorItemKey={options.initialEditorItemKey}
			listenOptions={options.listenOptions}
		/>,
		{
			kittyKeyboard: {
				mode: resolveKittyKeyboardMode(profile),
				flags: ["disambiguateEscapeCodes"],
			},
		},
	);
}
