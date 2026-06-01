import { getSkillsDir } from "@toby/core/config/index";
import { type LocalSkill, loadLocalSkills } from "@toby/core/skills/index";
import {
	deleteSkill,
	openSkillInEditor,
	updateSkillFrontmatter,
} from "@toby/core/skills/manage";
import { Box, Text, render, useApp, useInput } from "ink";
import { useCallback, useState } from "react";
import { ACCENT } from "../chat/constants";
import {
	ActionRow,
	ConfirmDialog,
	FieldEditor,
	NavigatorRow,
	SelectableTextRow,
	TwoPaneView,
	UI_GLYPHS,
	detectTerminalProfile,
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isQuitKey,
	isSelectKey,
	resolveKittyKeyboardMode,
	useTwoPaneNavigation,
} from "../shared";

const MAX_DESC_PREVIEW = 60;
const MAX_BODY_PREVIEW = 200;

function truncatePreview(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type EditableSkillFieldKey = "name" | "description" | "summary";

type SkillPaneItem =
	| {
			key: EditableSkillFieldKey;
			kind: "value";
			label: string;
			currentValue: string;
			multiline?: boolean;
	  }
	| { key: "file"; kind: "info"; label: string; currentValue: string }
	| { key: string; kind: "action"; label: string; actionKey: "edit" }
	| { key: string; kind: "delete"; label: string };

type Screen = "nav" | "edit" | "confirm";

interface SkillsAppProps {
	onQuitRequested?: () => void;
}

export function SkillsApp({ onQuitRequested }: SkillsAppProps) {
	const { exit } = useApp();
	const [skills, setSkills] = useState<LocalSkill[]>(() => loadLocalSkills());
	const [screen, setScreen] = useState<Screen>("nav");
	const {
		focusedPane,
		setFocusedPane,
		leftIndex,
		setLeftIndex,
		rightIndex,
		setRightIndex,
		toggleFocus,
	} = useTwoPaneNavigation({ leftCount: skills.length });
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);
	const [editItem, setEditItem] = useState<{
		field: EditableSkillFieldKey;
		label: string;
		value: string;
		multiline?: boolean;
	} | null>(null);

	const refreshSkills = useCallback(() => {
		const next = loadLocalSkills();
		setSkills(next);
		return next;
	}, []);

	const handleQuit = useCallback(() => {
		if (onQuitRequested) {
			onQuitRequested();
			return;
		}
		exit();
	}, [onQuitRequested, exit]);

	const handleListBack = useCallback(() => {
		handleQuit();
	}, [handleQuit]);

	const selectedSkill = skills[leftIndex] ?? null;

	const detailItems: SkillPaneItem[] = selectedSkill
		? [
				{
					key: "name",
					label: "Name",
					kind: "value",
					currentValue: selectedSkill.name,
				},
				{
					key: "description",
					label: "Description",
					kind: "value",
					currentValue: selectedSkill.description,
					multiline: true,
				},
				{
					key: "summary",
					label: "Summary",
					kind: "value",
					currentValue: selectedSkill.summary,
					multiline: true,
				},
				{
					key: "file",
					label: "File",
					kind: "info",
					currentValue: `${getSkillsDir()}/${selectedSkill.dirName}/SKILL.md`,
				},
				{
					key: "edit",
					kind: "action",
					label: "Edit in editor",
					actionKey: "edit",
				},
				{
					key: "delete",
					kind: "delete",
					label: "Delete skill",
				},
			]
		: [];

	useInput((input, key) => {
		if (screen !== "nav") return;

		if (isQuitKey(input, key)) {
			handleQuit();
			return;
		}

		if (key.tab) {
			toggleFocus(skills.length > 0);
			return;
		}

		if (focusedPane === "left") {
			if (isBackKey(input, key)) {
				handleListBack();
				return;
			}
			if (isNavigateUp(input, key)) {
				setLeftIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (isNavigateDown(input, key)) {
				setLeftIndex((prev) => Math.min(skills.length - 1, prev + 1));
				return;
			}
			if ((key.rightArrow || isSelectKey(input, key)) && selectedSkill) {
				setFocusedPane("right");
				setRightIndex(0);
			}
			return;
		}

		if (isBackKey(input, key) || key.leftArrow) {
			setFocusedPane("left");
			return;
		}
		if (isNavigateUp(input, key)) {
			setRightIndex((prev) => Math.max(0, prev - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			setRightIndex((prev) => Math.min(detailItems.length - 1, prev + 1));
			return;
		}
		if (isSelectKey(input, key)) {
			const item = detailItems[rightIndex];
			if (item) {
				handleDetailItem(item);
			}
		}
	});

	const handleDetailItem = useCallback(
		(item: SkillPaneItem) => {
			if (item.kind === "value") {
				setEditItem({
					field: item.key,
					label: item.label,
					value: item.currentValue,
					multiline: item.multiline,
				});
				setScreen("edit");
				setStatusMessage(undefined);
				return;
			}

			if (
				"actionKey" in item &&
				item.kind === "action" &&
				item.actionKey === "edit" &&
				selectedSkill
			) {
				try {
					openSkillInEditor(selectedSkill.dirName);
					setStatusMessage("Opened in editor.");
				} catch (e) {
					setStatusMessage(
						e instanceof Error ? e.message : "Failed to open editor.",
					);
				}
				return;
			}
			if (item.kind === "delete" && selectedSkill) {
				setConfirmMsg(`Delete skill "${selectedSkill.name}"?`);
				setConfirmAction(() => () => {
					try {
						deleteSkill(selectedSkill.dirName);
						refreshSkills();
						setLeftIndex(0);
						setRightIndex(0);
						setFocusedPane("left");
					} catch (e) {
						setStatusMessage(
							e instanceof Error ? e.message : "Failed to delete skill.",
						);
					}
					setConfirmAction(null);
					setConfirmMsg("");
				});
				setScreen("confirm");
			}
		},
		[selectedSkill, refreshSkills, setFocusedPane, setLeftIndex, setRightIndex],
	);

	const handleEditorSubmit = useCallback(
		(value: string) => {
			if (!selectedSkill || !editItem) {
				setScreen("nav");
				setEditItem(null);
				return;
			}
			try {
				updateSkillFrontmatter(selectedSkill.dirName, {
					[editItem.field]: value,
				});
				const nextSkills = refreshSkills();
				const nextIndex = nextSkills.findIndex(
					(skill) => skill.dirName === selectedSkill.dirName,
				);
				if (nextIndex >= 0) {
					setLeftIndex(nextIndex);
				}
				setFocusedPane("right");
				setStatusMessage("Skill updated.");
			} catch (e) {
				setStatusMessage(
					e instanceof Error ? e.message : "Failed to update skill.",
				);
			}
			setScreen("nav");
			setEditItem(null);
		},
		[editItem, refreshSkills, selectedSkill, setFocusedPane, setLeftIndex],
	);

	const handleEditorCancel = useCallback(() => {
		setScreen("nav");
		setEditItem(null);
	}, []);

	if (screen === "edit" && editItem) {
		return (
			<FieldEditor
				appTitle="Skills"
				fieldLabel={editItem.label}
				value={editItem.value}
				multiline={editItem.multiline}
				onSubmit={handleEditorSubmit}
				onCancel={handleEditorCancel}
			/>
		);
	}

	if (screen === "confirm" && confirmAction) {
		return (
			<ConfirmDialog
				title="Skills"
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("nav");
				}}
			/>
		);
	}

	const footerText =
		focusedPane === "left"
			? "↑↓ navigate · Enter open · Tab switch pane · q close"
			: "↑↓ navigate · Enter edit · Tab/Esc skills · q close";

	const bodyPreview = selectedSkill
		? truncatePreview(selectedSkill.bodyMarkdown, MAX_BODY_PREVIEW)
		: "";

	const leftPane = (
		<>
			{skills.map((skill, i) => {
				const isSelected = i === leftIndex && focusedPane === "left";
				const desc = truncatePreview(skill.description, MAX_DESC_PREVIEW);
				const label = skill.summary
					? `${desc} — ${truncatePreview(skill.summary, MAX_DESC_PREVIEW)}`
					: desc;
				return (
					<SelectableTextRow key={skill.dirName} selected={isSelected}>
						{UI_GLYPHS.section} {skill.name} <Text dimColor>{label}</Text>
					</SelectableTextRow>
				);
			})}
			{skills.length === 0 ? (
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>
						No skills found. Add skills to{" "}
						<Text color={ACCENT}>{getSkillsDir()}</Text>
					</Text>
				</Box>
			) : null}
		</>
	);

	const rightPane = selectedSkill ? (
		<>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Skills &gt; {selectedSkill.name}
				</Text>
			</Box>
			{detailItems.map((item, i) => {
				const isSelected = i === rightIndex && focusedPane === "right";
				if (item.kind === "action" || item.kind === "delete") {
					return (
						<ActionRow
							key={item.key}
							label={item.label}
							selected={isSelected}
							kind={item.kind}
						/>
					);
				}
				const rowKind = item.kind === "info" ? ("value" as const) : item.kind;
				return (
					<NavigatorRow
						key={item.key}
						label={item.label}
						kind={rowKind}
						selected={isSelected}
						multiline={"multiline" in item ? item.multiline : undefined}
						currentValue={item.currentValue}
					/>
				);
			})}
			<Box marginTop={1} paddingX={1}>
				<Text dimColor italic wrap="truncate-end">
					{bodyPreview}
				</Text>
			</Box>
		</>
	) : (
		<Box paddingX={1}>
			<Text dimColor>Select a skill on the left.</Text>
		</Box>
	);

	return (
		<TwoPaneView
			title="Skills"
			statusBar={<Text dimColor>{footerText}</Text>}
			focusedPane={focusedPane}
			left={leftPane}
			right={rightPane}
			status={
				statusMessage ? (
					<Box marginTop={1} paddingX={1}>
						<Text color="yellow">{statusMessage}</Text>
					</Box>
				) : null
			}
		/>
	);
}

export function runSkillsUI(): void {
	const profile = detectTerminalProfile();
	render(<SkillsApp />, {
		kittyKeyboard: {
			mode: resolveKittyKeyboardMode(profile),
			flags: ["disambiguateEscapeCodes"],
		},
	});
}
