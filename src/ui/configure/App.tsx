import { Text, render, useApp } from "ink";
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { normalizeModelOnProviderChange } from "../../ai/model-factory";
import { DEFAULT_CHAT_PERSONA } from "../../personas/index";
import {
	ConfirmDialog,
	FieldEditor,
	FieldNavigator,
	FieldSelector,
	UI_HINTS,
	detectTerminalProfile,
	resolveKittyKeyboardMode,
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
	/** When set (e.g. from chat `/persona`), open navigation at this key path under root. */
	initialPath?: readonly string[];
	initialSelectedIndex?: number;
	/** When set, open the value/select editor for this item key under the current section (after `initialPath` resolves). */
	initialEditorItemKey?: string;
}

function resolvePath(
	root: SettingsItem,
	keys: string[],
): {
	node: SettingsItem;
	resolvedPath: string[];
} {
	let node = root;
	const resolvedPath = [root.key];

	for (let i = 1; i < keys.length; i++) {
		const child = node.children?.find((c) => c.key === keys[i]);
		if (!child) {
			break;
		}
		node = child;
		resolvedPath.push(keys[i]);
	}

	return { node, resolvedPath };
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
	const [path, setPath] = useState<string[]>(["root"]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editItem, setEditItem] = useState<SettingsItem | null>(null);
	const [values, setValues] =
		useState<Record<string, string>>(credentialValues);
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);

	const initialNavigateRef = useRef({
		path: initialPath,
		index: initialSelectedIndex,
	});
	useLayoutEffect(() => {
		const spec = initialNavigateRef.current;
		if (!spec.path?.length) {
			return;
		}
		const { resolvedPath } = resolvePath(tree, [...spec.path]);
		setPath(resolvedPath);
		setSelectedIndex(spec.index);
		initialNavigateRef.current = { path: undefined, index: 0 };
	}, [tree]);

	const initialEditorKeyRef = useRef(initialEditorItemKey);
	useLayoutEffect(() => {
		const key = initialEditorKeyRef.current;
		if (!key) {
			return;
		}
		const { node } = resolvePath(tree, path);
		const child = node.children?.find((c) => c.key === key || c.navKey === key);
		if (!child) {
			return;
		}
		initialEditorKeyRef.current = undefined;
		if (child.kind === "value") {
			setEditItem(child);
			setScreen("edit");
		} else if (child.kind === "select") {
			setEditItem(child);
			setScreen("select");
		}
	}, [path, tree]);

	const { node: currentNode, resolvedPath } = resolvePath(tree, path);
	const childItems = currentNode.children ?? [];
	const childByNavKey = new Map(
		childItems.map((item) => [item.navKey ?? item.key, item]),
	);
	const items = childItems.map((item) => {
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
			key: item.navKey ?? item.key,
			label: item.label,
			kind: item.kind,
			masked: item.masked,
			multiline: item.multiline,
			options: item.options,
			currentValue: displayValue,
		};
	});

	const breadcrumb = resolvedPath
		.map((_, index) => {
			const node = resolvePath(tree, resolvedPath.slice(0, index + 1)).node;
			return node.label;
		})
		.filter(Boolean);

	const doRefresh = useCallback(
		(newValues: Record<string, string>) => {
			const newTree = refreshTree(newValues);
			setTree(newTree);
			setPath((prevPath) => resolvePath(newTree, prevPath).resolvedPath);
			setSelectedIndex(0);
		},
		[refreshTree],
	);

	const isDirty = Object.keys(values).some(
		(key) => values[key] !== credentialValues[key],
	);

	const doExit = useCallback(() => {
		if (onQuitRequested) {
			onQuitRequested(values);
			return;
		}
		onSave(values);
		exit();
	}, [values, onSave, exit, onQuitRequested]);

	const handleSave = useCallback(() => {
		onSave(values);
		setStatusMessage("Configuration saved.");
	}, [values, onSave]);

	const handleBack = useCallback(() => {
		if (path.length > 1) {
			if (isDirty) {
				setConfirmMsg("Discard unsaved changes?");
				setConfirmAction(() => () => {
					setConfirmAction(null);
					setConfirmMsg("");
					setPath((p) => p.slice(0, -1));
					setSelectedIndex(0);
					setStatusMessage(undefined);
				});
				setScreen("confirm");
				return;
			}
			setPath((p) => p.slice(0, -1));
			setSelectedIndex(0);
		} else {
			if (isDirty) {
				setConfirmMsg("Discard unsaved changes?");
				setConfirmAction(() => () => {
					setConfirmAction(null);
					setConfirmMsg("");
					doExit();
				});
				setScreen("confirm");
				return;
			}
			doExit();
		}
		setStatusMessage(undefined);
	}, [path, isDirty, doExit]);

	const handleSelectItem = useCallback(
		(item: SettingsItem) => {
			setStatusMessage(undefined);
			if (item.kind === "section") {
				setPath((p) => {
					const nextPath = [...p, item.key];
					const resolvedNextPath = resolvePath(tree, nextPath).resolvedPath;
					if (resolvedNextPath.length !== nextPath.length) {
						return p;
					}
					setSelectedIndex(0);
					return nextPath;
				});
			} else if (item.kind === "value") {
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
					doRefresh(newValues);
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
					setPath((p) => p.slice(0, -1));
					setSelectedIndex(0);
					setScreen("nav");
				});
				setScreen("confirm");
			}
		},
		[values, doRefresh, callbacks, tree],
	);

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
						const migratedValues: Record<string, string> = {
							...newValues,
						};

						for (const [key, value] of Object.entries(newValues)) {
							if (!key.startsWith(oldPrefix)) {
								continue;
							}
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

	const handleEditorCancel = useCallback(() => {
		setScreen("nav");
		setEditItem(null);
	}, []);

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

	return (
		<FieldNavigator
			appTitle="Configuration"
			breadcrumb={breadcrumb}
			items={items}
			selectedIndex={selectedIndex}
			statusMessage={statusMessage}
			footer={<Text dimColor>{UI_HINTS.fieldBrowse}</Text>}
			onSelect={setSelectedIndex}
			onBack={handleBack}
			onSelectItem={(navItem) => {
				const settingsItem = childByNavKey.get(navItem.key);
				if (settingsItem) {
					handleSelectItem(settingsItem);
				}
			}}
			onSave={handleSave}
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
