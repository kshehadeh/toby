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
import { ACCENT } from "../chat/constants";
import {
	ActionRow,
	ConfirmDialog,
	FieldEditor,
	FieldSelector,
	NavigatorRow,
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
	resolveKittyKeyboardMode,
	useTwoPaneNavigation,
} from "../shared";
import type { SettingsItem } from "./items";

type Screen = "nav" | "edit" | "select" | "confirm";

interface AppCallbacks {
	onCreatePersona: () => string;
	onDeletePersona: (name: string) => void;
	onSetDefaultPersona: (name: string) => void;
	onClearDefaultPersona: () => void;
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
}

interface FlatTreeNode {
	item: SettingsItem;
	depth: number;
}

/** Flatten the SettingsItem tree into section-only nodes, respecting expansion state. */
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
				walk(child, depth + 1);
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

	// ── Flatten tree for left pane ──────────────────────────────────────
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
				item.kind === "value" || item.kind === "select"
					? (values[item.key] ?? item.currentValue)
					: undefined;
			let displayValue = rawValue;
			if (item.kind === "select" && rawValue !== undefined) {
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
				currentValue: displayValue,
			};
		});
	}, [selectedNode, selectedHasSubCategories, values]);

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
		const ancestorKeys = findAncestorKeys(tree, targetKey);
		const newExpanded = new Set(expandedKeys);
		for (const key of ancestorKeys) newExpanded.add(key);

		const newFlat = flattenTreeSections(tree, newExpanded);
		const idx = newFlat.findIndex((n) => n.item.key === targetKey);

		setExpandedKeys(newExpanded);
		if (idx >= 0) {
			setLeftIndex(idx);
			setFocusedPane("right");
		}

		initialNavigateRef.current = { path: undefined, index: 0 };
	}, [tree]);

	// ── Initial editor key ──────────────────────────────────────────────
	const initialEditorKeyRef = useRef(initialEditorItemKey);
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
		}
	}, [selectedNode]);

	// ── Reset right index when left selection changes ───────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useLayoutEffect(() => {
		setRightIndex(0);
	}, [leftIndex, selectedNode]);

	// ── Dirty detection ─────────────────────────────────────────────────
	const isDirty = Object.keys(values).some(
		(key) => values[key] !== savedValues[key],
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

	// ── Handle item activation in right pane ────────────────────────────
	const handleSelectItem = useCallback(
		(item: SettingsItem) => {
			setStatusMessage(undefined);

			if (item.kind === "section") {
				navigateToSection(item.key);
				return;
			}

			if (item.kind === "value") {
				setEditItem(item);
				setScreen("edit");
			} else if (item.kind === "select") {
				setEditItem(item);
				setScreen("select");
			} else if (item.kind === "action") {
				if (item.key === "personas._new") {
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

					// Navigate to the new persona using the refreshed tree
					const ancestorKeys = findAncestorKeys(
						newTree,
						`personas.${personaName}`,
					);
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
				}
			} else if (item.kind === "delete") {
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
					setScreen("nav");
				});
				setScreen("confirm");
			}
		},
		[
			values,
			doRefresh,
			callbacks,
			navigateToSection,
			expandedKeys,
			setLeftIndex,
			setFocusedPane,
		],
	);

	// ── Editor submit ───────────────────────────────────────────────────
	const handleEditorSubmit = useCallback(
		(newValue: string) => {
			if (editItem) {
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
			setStatusMessage(undefined);
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, values, doRefresh],
	);

	// ── Select submit ────────────────────────────────────────────────────
	const handleSelectSubmit = useCallback(
		(newValue: string) => {
			if (editItem) {
				let newValues = { ...values, [editItem.key]: newValue };
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
		[editItem, values, doRefresh],
	);

	// ── Editor cancel ───────────────────────────────────────────────────
	const handleEditorCancel = useCallback(() => {
		setScreen("nav");
		setEditItem(null);
	}, []);

	// ── Input handling ──────────────────────────────────────────────────
	useInput((input, key) => {
		if (screen !== "nav") return;

		// Global: save from any pane
		if (isSaveKey(input, key)) {
			handleSave();
			return;
		}

		// Global: quit
		if (isQuitKey(input, key)) {
			if (isDirty) {
				setConfirmMsg("Discard unsaved changes?");
				setConfirmAction(() => () => {
					setConfirmAction(null);
					setConfirmMsg("");
					setValues(savedValues);
					doRefresh(savedValues);
					doExit();
				});
				setScreen("confirm");
				return;
			}
			doExit();
			return;
		}

		// Tab switches panes
		if (key.tab) {
			toggleFocus(rightPaneItems.length > 0);
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
				} else if (rightPaneItems.length > 0) {
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
				} else if (rightPaneItems.length > 0) {
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
					setScreen("confirm");
					return;
				}
				doExit();
				return;
			}
			return;
		}

		// ── Right pane: field navigation ─────────────────────────────────
		if (isNavigateUp(input, key)) {
			setRightIndex((prev) => Math.max(0, prev - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			setRightIndex((prev) => Math.min(rightPaneItems.length - 1, prev + 1));
			return;
		}
		if (isSelectKey(input, key)) {
			const rightItem = rightPaneItems[rightIndex];
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

	// ── Confirm dialog overlay ──────────────────────────────────────────
	if (screen === "confirm" && confirmAction) {
		return (
			<ConfirmDialog
				title="Configuration"
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
					setConfirmAction(null);
					setConfirmMsg("");
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("nav");
				}}
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

	// ── Main 2-pane layout ──────────────────────────────────────────────
	const footerText =
		focusedPane === "left"
			? "↑↓ navigate · → expand · ← collapse · Enter open · s save · q close"
			: "↑↓ navigate · Enter edit · s save · Tab/Esc tree · q close";

	const leftPane = (
		<>
			{flatNodes.map((node, i) => {
				const isSelected = i === leftIndex;
				const isActive = focusedPane === "left";
				const isExpanded = expandedKeys.has(node.item.key);
				const hasSubCats =
					node.item.children?.some((c) => c.kind === "section") ?? false;
				const indent = "  ".repeat(node.depth);
				const expandGlyph = hasSubCats ? (isExpanded ? "▾" : "▸") : " ";

				return (
					<SelectableTextRow
						key={node.item.key}
						selected={isSelected && isActive}
						dim={isSelected && !isActive}
					>
						<Text>
							{indent}
							{expandGlyph} {node.item.label}
						</Text>
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

	const rightPane =
		selectedNode && !selectedHasSubCategories ? (
			<>
				<Box paddingX={1} marginBottom={1}>
					<Text bold color={ACCENT}>
						{selectedNode.label}
					</Text>
				</Box>
				{rightPaneItems.length === 0 ? (
					<Box paddingX={1}>
						<Text dimColor>
							{selectedNode.children?.some((c) => c.kind === "section")
								? "Expand this category to select a sub-category."
								: "No fields in this section."}
						</Text>
					</Box>
				) : (
					rightPaneItems.map((rightItem, i) => {
						const selected = i === rightIndex && focusedPane === "right";

						if (rightItem.kind === "section") {
							return (
								<SelectableTextRow key={rightItem.key} selected={selected}>
									<Text color="green">
										{UI_GLYPHS.section} {rightItem.label}
									</Text>
								</SelectableTextRow>
							);
						}
						if (rightItem.kind === "action") {
							return (
								<ActionRow
									key={rightItem.key}
									label={rightItem.label}
									selected={selected}
									kind="action"
								/>
							);
						}
						if (rightItem.kind === "delete") {
							return (
								<ActionRow
									key={rightItem.key}
									label={rightItem.label}
									selected={selected}
									kind="delete"
								/>
							);
						}
						return (
							<NavigatorRow
								key={rightItem.key}
								label={rightItem.label}
								kind={rightItem.kind as "value" | "select"}
								selected={selected}
								masked={rightItem.masked}
								multiline={rightItem.multiline}
								currentValue={rightItem.currentValue}
								options={rightItem.options}
							/>
						);
					})
				)}
			</>
		) : (
			<Box paddingX={1}>
				<Text dimColor>Select a category on the left.</Text>
			</Box>
		);

	return (
		<TwoPaneView
			title="Configuration"
			leftMaxWidth={100}
			statusBar={<Text dimColor>{footerText}</Text>}
			focusedPane={focusedPane}
			left={leftPane}
			right={rightPane}
			status={
				statusMessage ? (
					<Box paddingX={1} marginTop={1}>
						<Text color="yellow">{statusMessage}</Text>
					</Box>
				) : null
			}
		/>
	);
}

export function runConfigureUI(
	root: SettingsItem,
	credentialValues: Record<string, string>,
	onSave: (values: Record<string, string>) => void,
	refreshTree: (values: Record<string, string>) => SettingsItem,
	callbacks: {
		onCreatePersona: () => string;
		onDeletePersona: (name: string) => void;
		onSetDefaultPersona: (name: string) => void;
		onClearDefaultPersona: () => void;
	},
): void {
	const profile = detectTerminalProfile();
	render(
		<ConfigureApp
			root={root}
			credentialValues={credentialValues}
			onSave={onSave}
			refreshTree={refreshTree}
			callbacks={callbacks}
		/>,
		{
			kittyKeyboard: {
				mode: resolveKittyKeyboardMode(profile),
				flags: ["disambiguateEscapeCodes"],
			},
		},
	);
}
