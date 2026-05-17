import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useState } from "react";
import { listPersonas } from "../../personas/index";
import {
	cronToHuman,
	humanToCron,
	humanToCronAsync,
	isValidCronExpression,
} from "../../schedules/cron";
import { executeSchedule } from "../../schedules/executor";
import {
	createSchedule,
	deleteSchedule as deleteScheduleFromStore,
	listScheduleRuns,
	listSchedules,
	updateSchedule,
} from "../../schedules/store";
import type {
	CreateScheduleParams,
	Schedule,
	ScheduleRun,
} from "../../schedules/types";
import { AppHeader } from "../chat/components/app-header";
import { ACCENT, INPUT_BORDER } from "../chat/constants";
import { MultilineTextEdit, newlineHintText } from "../shared";
import { detectTerminalProfile, resolveKittyKeyboardMode } from "../shared";

const MAX_PROMPT_PREVIEW = 60;
const MAX_OUTPUT_PREVIEW = 80;

type Screen = "list" | "create" | "edit" | "detail" | "confirm" | "runOutput";

interface ScheduleFormState {
	name: string;
	prompt: string;
	personaName: string;
	cronExpression: string;
	enabled: boolean;
}

const DEFAULT_FORM: ScheduleFormState = {
	name: "",
	prompt: "",
	personaName: "Toby",
	cronExpression: "0 9 * * *",
	enabled: true,
};

function SchedulesFrame({
	title,
	children,
	footer,
}: {
	readonly title: string;
	readonly children: React.ReactNode;
	readonly footer?: React.ReactNode;
}) {
	return (
		<Box flexDirection="column" padding={1}>
			<AppHeader
				subheader={
					<Text color={ACCENT} bold wrap="truncate-end">
						{title}
					</Text>
				}
			/>
			<Box
				marginTop={1}
				borderStyle="single"
				borderColor={INPUT_BORDER}
				flexDirection="column"
			>
				{children}
			</Box>
			{footer ? (
				<Box marginTop={1} paddingX={1}>
					{footer}
				</Box>
			) : null}
		</Box>
	);
}

interface ScheduleListProps {
	schedules: Schedule[];
	selectedIndex: number;
	onSelect: (index: number) => void;
	onSelectSchedule: (schedule: Schedule) => void;
	onCreate: () => void;
	onQuit: () => void;
}

function ScheduleList({
	schedules,
	selectedIndex,
	onSelect,
	onSelectSchedule,
	onCreate,
	onQuit,
}: ScheduleListProps) {
	useInput((input, key) => {
		if (input === "q") {
			onQuit();
			return;
		}
		if (input === "c" || input === "n") {
			onCreate();
			return;
		}
		if (key.upArrow) {
			onSelect(Math.max(0, selectedIndex - 1));
			return;
		}
		if (key.downArrow) {
			onSelect(Math.min(schedules.length - 1, selectedIndex + 1));
			return;
		}
		if (key.return && schedules[selectedIndex]) {
			onSelectSchedule(schedules[selectedIndex]);
		}
	});

	if (schedules.length === 0) {
		return (
			<SchedulesFrame
				title="Schedules"
				footer={<Text dimColor>c create · q close</Text>}
			>
				<Box paddingX={1} paddingY={1}>
					<Text dimColor>No schedules yet. Press </Text>
					<Text color={ACCENT} bold>
						c
					</Text>
					<Text dimColor> to create one.</Text>
				</Box>
			</SchedulesFrame>
		);
	}

	return (
		<SchedulesFrame
			title="Schedules"
			footer={
				<Text dimColor>↑↓ navigate · Enter select · c create · q close</Text>
			}
		>
			{schedules.map((schedule, i) => {
				const selected = i === selectedIndex;
				const statusIcon = schedule.enabled ? "✔︎" : "✗";
				const statusColor = schedule.enabled ? "green" : "red";
				const humanCron = cronToHuman(schedule.cronExpression);
				const promptPreview =
					schedule.prompt.length > MAX_PROMPT_PREVIEW
						? `${schedule.prompt.slice(0, MAX_PROMPT_PREVIEW - 1)}…`
						: schedule.prompt;
				return (
					<Box key={schedule.id} paddingX={1}>
						<Text wrap="truncate-end">
							<Text color={selected ? ACCENT : "gray"} bold>
								{selected ? "› " : "  "}
							</Text>
							<Text color={statusColor}>{statusIcon}</Text>
							<Text color={selected ? "white" : "gray"} bold={selected}>
								{" "}
								▸ {schedule.name}{" "}
							</Text>
							<Text dimColor>{humanCron} · </Text>
							<Text dimColor italic>
								{promptPreview}
							</Text>
						</Text>
					</Box>
				);
			})}
		</SchedulesFrame>
	);
}

type FormField = "name" | "prompt" | "persona" | "cron" | "enabled";

function formFieldToKey(field: FormField): keyof ScheduleFormState {
	switch (field) {
		case "persona":
			return "personaName";
		case "cron":
			return "cronExpression";
		default:
			return field;
	}
}

interface ScheduleFormProps {
	form: ScheduleFormState;
	selectedField: FormField;
	personas: { name: string }[];
	isCreating: boolean;
	saving: boolean;
	statusMessage?: string;
	onFieldFocus: (field: FormField) => void;
	onEditField: (field: FormField) => void;
	onToggleEnabled: () => void;
	onCyclePersona: () => void;
	onSave: () => void;
	onBack: () => void;
}

function ScheduleForm({
	form,
	selectedField,
	personas,
	isCreating,
	saving,
	statusMessage,
	onFieldFocus,
	onEditField,
	onToggleEnabled,
	onCyclePersona,
	onSave,
	onBack,
}: ScheduleFormProps) {
	const fields: {
		key: FormField;
		label: string;
		value: string;
		editable: boolean;
		multiline?: boolean;
	}[] = [
		{
			key: "name",
			label: "Name",
			value: form.name || "(empty)",
			editable: true,
		},
		{
			key: "prompt",
			label: "Prompt",
			value:
				form.prompt.length > MAX_PROMPT_PREVIEW
					? `${form.prompt.slice(0, MAX_PROMPT_PREVIEW - 1)}…`
					: form.prompt || "(empty)",
			editable: true,
			multiline: true,
		},
		{
			key: "persona",
			label: "Persona",
			value: form.personaName,
			editable: true,
		},
		{
			key: "cron",
			label: "Schedule",
			value: `${form.cronExpression} (${cronToHuman(form.cronExpression)})`,
			editable: true,
		},
		{
			key: "enabled",
			label: "Enabled",
			value: form.enabled ? "Yes" : "No",
			editable: false,
		},
	];

	useInput((input, key) => {
		if (saving) return;
		if (key.upArrow) {
			const idx = fields.findIndex((f) => f.key === selectedField);
			onFieldFocus(fields[Math.max(0, idx - 1)]?.key ?? "name");
			return;
		}
		if (key.downArrow) {
			const idx = fields.findIndex((f) => f.key === selectedField);
			onFieldFocus(
				fields[Math.min(fields.length - 1, idx + 1)]?.key ?? "enabled",
			);
			return;
		}
		if (key.return) {
			const current = fields.find((f) => f.key === selectedField);
			if (current?.editable) {
				onEditField(selectedField);
			} else if (selectedField === "enabled") {
				onToggleEnabled();
			}
			return;
		}
		if (key.escape || input === "b") {
			onBack();
			return;
		}
		if (input === "s") {
			onSave();
			return;
		}
		if (selectedField === "enabled" && (input === " " || input === "t")) {
			onToggleEnabled();
			return;
		}
		if (selectedField === "persona" && (key.tab || input === " ")) {
			onCyclePersona();
			return;
		}
	});

	const title = isCreating ? "Schedules > New" : "Schedules > Edit";

	return (
		<SchedulesFrame
			title={title}
			footer={
				<Text dimColor>
					↑↓ navigate · Enter edit · s save · b back · Esc cancel · Schedule
					accepts natural language
				</Text>
			}
		>
			{fields.map((field) => {
				const active = field.key === selectedField;
				const hint =
					active && field.key === "enabled"
						? " (Space/t toggle)"
						: active && field.key === "persona"
							? " (Tab cycle)"
							: active && field.editable
								? " (Enter edit)"
								: "";
				const prefix = active ? "› " : "  ";
				if (field.multiline) {
					return (
						<Box key={field.key} paddingX={1} flexDirection="column">
							<Text bold color={active ? ACCENT : undefined}>
								{prefix}
								{field.label}
								{hint ? (
									<Text dimColor italic>
										{hint}
									</Text>
								) : null}
							</Text>
							<Text dimColor wrap="truncate-end">
								{"    "}
								{field.value}
							</Text>
						</Box>
					);
				}
				return (
					<Box key={field.key} paddingX={1} flexDirection="row">
						<Text bold color={active ? ACCENT : undefined}>
							{prefix}
							{field.label}
							{hint ? (
								<Text dimColor italic>
									{hint}
								</Text>
							) : null}
						</Text>
						<Text dimColor wrap="truncate-end">
							{": "}
							{field.value}
						</Text>
					</Box>
				);
			})}
			{statusMessage ? (
				<Box marginTop={1} paddingX={1}>
					<Text color="yellow">{statusMessage}</Text>
				</Box>
			) : null}
		</SchedulesFrame>
	);
}

interface ScheduleDetailProps {
	schedule: Schedule;
	runs: ScheduleRun[];
	selectedIndex: number;
	running: boolean;
	onSelect: (index: number) => void;
	onEdit: () => void;
	onDelete: () => void;
	onRunNow: () => void;
	onViewRun: (run: ScheduleRun) => void;
	onBack: () => void;
}

function ScheduleDetail({
	schedule,
	runs,
	selectedIndex,
	running,
	onSelect,
	onEdit,
	onDelete,
	onRunNow,
	onViewRun,
	onBack,
}: ScheduleDetailProps) {
	type DetailItem =
		| { kind: "info"; label: string; value: string; multiline?: boolean }
		| { kind: "action"; label: string; actionKey: string }
		| { kind: "delete"; label: string; actionKey: string }
		| { kind: "run"; run: ScheduleRun };

	const infoItems: DetailItem[] = [
		{ kind: "info", label: "Name", value: schedule.name },
		{ kind: "info", label: "Prompt", value: schedule.prompt, multiline: true },
		{
			kind: "info",
			label: "Persona",
			value: schedule.personaName,
		},
		{
			kind: "info",
			label: "Schedule",
			value: `${schedule.cronExpression} (${cronToHuman(schedule.cronExpression)})`,
		},
		{
			kind: "info",
			label: "Enabled",
			value: schedule.enabled ? "Yes" : "No",
		},
		{
			kind: "info",
			label: "Last run",
			value: schedule.lastRunAt
				? new Date(schedule.lastRunAt).toLocaleString()
				: "Never",
		},
		{
			kind: "action",
			label: running ? "Running…" : "Run now",
			actionKey: "run",
		},
		{ kind: "action", label: "Edit schedule", actionKey: "edit" },
		{ kind: "delete", label: "Delete schedule", actionKey: "delete" },
	];

	const runItems: DetailItem[] = runs.map((r) => ({
		kind: "run" as const,
		run: r,
	}));

	const items =
		runs.length > 0
			? [
					...infoItems,
					{ kind: "info" as const, label: "Recent runs", value: "" },
					...runItems,
				]
			: infoItems;

	useInput((input, key) => {
		if (running) return;
		if (key.upArrow) {
			onSelect(Math.max(0, selectedIndex - 1));
			return;
		}
		if (key.downArrow) {
			onSelect(Math.min(items.length - 1, selectedIndex + 1));
			return;
		}
		if (key.backspace || input === "b") {
			onBack();
			return;
		}
		if (key.return) {
			const item = items[selectedIndex];
			if (!item) return;
			if (item.kind === "action" && item.actionKey === "edit") {
				onEdit();
			} else if (item.kind === "action" && item.actionKey === "run") {
				onRunNow();
			} else if (item.kind === "delete" && item.actionKey === "delete") {
				onDelete();
			} else if (item.kind === "run") {
				onViewRun(item.run);
			}
		}
	});

	return (
		<SchedulesFrame
			title={`Schedules > ${schedule.name}`}
			footer={
				<Text dimColor>↑↓ navigate · Enter select · b back · q close</Text>
			}
		>
			{items.map((item, i) => {
				const selected = i === selectedIndex;
				if (item.kind === "info") {
					if (item.label === "Recent runs") {
						return (
							<Box key={item.label} paddingX={1} marginTop={1}>
								<Text bold color={ACCENT}>
									─── Recent runs ───
								</Text>
							</Box>
						);
					}
					const prefix = selected ? "› " : "  ";
					if (item.multiline) {
						return (
							<Box key={item.label} paddingX={1} flexDirection="column">
								<Text bold color={selected ? ACCENT : undefined}>
									{prefix}
									{item.label}
								</Text>
								<Text dimColor wrap="truncate-end">
									{"    "}
									{item.value}
								</Text>
							</Box>
						);
					}
					return (
						<Box key={item.label} paddingX={1} flexDirection="row">
							<Text bold color={selected ? ACCENT : undefined}>
								{prefix}
								{item.label}
							</Text>
							<Text dimColor wrap="truncate-end">
								{": "}
								{item.value}
							</Text>
						</Box>
					);
				}
				if (item.kind === "run") {
					const statusIcon =
						item.run.status === "success"
							? "✔︎"
							: item.run.status === "error"
								? "✗"
								: "…";
					const statusColor =
						item.run.status === "success"
							? "green"
							: item.run.status === "error"
								? "red"
								: "yellow";
					const output =
						item.run.output && item.run.output.length > MAX_OUTPUT_PREVIEW
							? `${item.run.output.slice(0, MAX_OUTPUT_PREVIEW - 1)}…`
							: (item.run.output ?? "(no output)");
					return (
						<Box key={item.run.id} paddingX={1} flexDirection="column">
							<Text>
								<Text color={selected ? ACCENT : "gray"} bold>
									{selected ? "› " : "  "}
								</Text>
								<Text color={statusColor}>{statusIcon}</Text>
								<Text dimColor>
									{" "}
									{new Date(item.run.startedAt).toLocaleString()}
								</Text>
							</Text>
							<Text dimColor italic wrap="truncate-end">
								{"    "}
								{item.run.error ?? output}
							</Text>
						</Box>
					);
				}
				const icon = item.kind === "action" ? "+" : "✕";
				const color = item.kind === "action" ? "yellow" : "red";
				return (
					<Box key={item.actionKey} paddingX={1}>
						<Text>
							<Text color={selected ? ACCENT : "gray"} bold>
								{selected ? "› " : "  "}
							</Text>
							<Text color={selected ? "white" : color} bold={selected}>
								{icon} {item.label}
							</Text>
						</Text>
					</Box>
				);
			})}
		</SchedulesFrame>
	);
}

interface ConfirmDialogProps {
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
	useInput((input, key) => {
		if (key.return || input === "y") {
			onConfirm();
			return;
		}
		if (key.escape || input === "n") {
			onCancel();
		}
	});

	return (
		<SchedulesFrame
			title="Schedules"
			footer={<Text dimColor>y/Enter confirm · n/Esc cancel</Text>}
		>
			<Box paddingX={1}>
				<Text bold color="yellow">
					{message}
				</Text>
			</Box>
		</SchedulesFrame>
	);
}

interface RunOutputViewProps {
	run: ScheduleRun;
	scheduleName: string;
	onBack: () => void;
}

function RunOutputView({ run, scheduleName, onBack }: RunOutputViewProps) {
	const [scrollOffset, setScrollOffset] = useState(0);
	const { stdout } = useStdout();

	const statusIcon =
		run.status === "success" ? "✔︎" : run.status === "error" ? "✗" : "…";
	const statusColor =
		run.status === "success"
			? "green"
			: run.status === "error"
				? "red"
				: "yellow";

	const rawOutput = run.output ?? "(no output)";
	const lines = rawOutput.split("\n");
	const totalLines = lines.length;

	// Reserve rows for: AppHeader(2), border-top(1), status block(2),
	// "Output" separator(1), border-bottom(1), footer(2), padding(2) = ~11
	const chromeRows = 11;
	const terminalRows = stdout?.rows ?? 24;
	const visibleLines = Math.max(3, terminalRows - chromeRows);
	const maxOffset = Math.max(0, totalLines - visibleLines);

	const visible = lines.slice(scrollOffset, scrollOffset + visibleLines);

	useInput((input, key) => {
		if (key.escape || input === "b" || key.backspace) {
			onBack();
			return;
		}
		if (key.downArrow || input === "j") {
			setScrollOffset((o) => Math.min(o + 1, maxOffset));
			return;
		}
		if (key.upArrow || input === "k") {
			setScrollOffset((o) => Math.max(o - 1, 0));
			return;
		}
		if (key.pageDown || input === " ") {
			setScrollOffset((o) => Math.min(o + visibleLines, maxOffset));
			return;
		}
		if (key.pageUp) {
			setScrollOffset((o) => Math.max(o - visibleLines, 0));
			return;
		}
		if (input === "g") {
			setScrollOffset(0);
			return;
		}
		if (input === "G") {
			setScrollOffset(maxOffset);
			return;
		}
	});

	const scrollIndicator =
		totalLines > visibleLines
			? ` [${scrollOffset + 1}-${Math.min(scrollOffset + visibleLines, totalLines)}/${totalLines}]`
			: "";

	return (
		<SchedulesFrame
			title={`Schedules > ${scheduleName} > Run ${new Date(run.startedAt).toLocaleString()}`}
			footer={
				<Text dimColor>
					↑↓/j/k scroll · Space/PageDn · PageUp · g/G top/bottom · b/Esc back
				</Text>
			}
		>
			<Box paddingX={1} flexDirection="column">
				<Text>
					<Text color={statusColor}>{statusIcon}</Text>
					<Text dimColor>
						{" "}
						{run.status.toUpperCase()} ·{" "}
						{new Date(run.startedAt).toLocaleString()}
						{run.completedAt
							? ` → ${new Date(run.completedAt).toLocaleString()}`
							: ""}
					</Text>
				</Text>
				{run.error ? <Text color="red">{run.error}</Text> : null}
			</Box>
			<Box marginTop={1} paddingX={1}>
				<Text bold color={ACCENT}>
					─── Output{scrollIndicator} ───
				</Text>
			</Box>
			<Box paddingX={1} flexDirection="column">
				{visible.map((line, i) => (
					<Text key={`line-${run.id}-${scrollOffset + i}`}>{line}</Text>
				))}
			</Box>
		</SchedulesFrame>
	);
}

interface FieldEditorProps {
	label: string;
	value: string;
	placeholder?: string;
	multiline?: boolean;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

function FieldEditor({
	label,
	value: initialValue,
	placeholder,
	multiline = false,
	onSubmit,
	onCancel,
}: FieldEditorProps) {
	const [value, setValue] = useState(initialValue);
	const [cursorResetToken, setCursorResetToken] = useState(0);

	useInput((input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	const enterMode = multiline ? "newline" : "submit";

	return (
		<SchedulesFrame
			title="Schedules > Edit"
			footer={
				<Text dimColor>
					{multiline
						? `${newlineHintText(detectTerminalProfile())} · Ctrl+S confirm · Esc cancel`
						: "Enter confirm · Esc cancel"}
				</Text>
			}
		>
			<Box paddingX={1} flexDirection="column">
				<Text bold color={ACCENT}>
					{label}
				</Text>
			</Box>
			<Box marginTop={1} paddingX={1}>
				<MultilineTextEdit
					width={60}
					value={value}
					onChange={setValue}
					onSubmit={(v) => {
						onSubmit(v);
						setCursorResetToken((t) => t + 1);
					}}
					focus
					placeholder={placeholder}
					accentColor={ACCENT}
					rows={1}
					maxRows={multiline ? 6 : 1}
					cursorResetToken={cursorResetToken}
					enterMode={enterMode}
					onCancel={onCancel}
				/>
			</Box>
		</SchedulesFrame>
	);
}

interface SchedulesAppProps {
	onQuitRequested?: () => void;
}

export function SchedulesApp({ onQuitRequested }: SchedulesAppProps) {
	const { exit } = useApp();
	const [schedules, setSchedules] = useState<Schedule[]>(() => listSchedules());
	const [screen, setScreen] = useState<Screen>("list");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [detailIndex, setDetailIndex] = useState(0);
	const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(
		null,
	);
	const [runs, setRuns] = useState<ScheduleRun[]>([]);
	const [confirmMsg, setConfirmMsg] = useState("");
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | undefined>(
		undefined,
	);
	const [editingField, setEditingField] = useState<FormField | null>(null);
	const [form, setForm] = useState<ScheduleFormState>(DEFAULT_FORM);
	const [formFieldIndex, setFormFieldIndex] = useState(0);
	const [isCreating, setIsCreating] = useState(false);
	const [saving, setSaving] = useState(false);
	const [running, setRunning] = useState(false);
	const [selectedRun, setSelectedRun] = useState<ScheduleRun | null>(null);

	const personas = listPersonas();
	const formFields: FormField[] = [
		"name",
		"prompt",
		"persona",
		"cron",
		"enabled",
	];

	const refreshSchedules = useCallback(() => {
		setSchedules(listSchedules());
	}, []);

	const handleQuit = useCallback(() => {
		if (onQuitRequested) {
			onQuitRequested();
			return;
		}
		exit();
	}, [onQuitRequested, exit]);

	const handleSelectSchedule = useCallback((schedule: Schedule) => {
		setSelectedSchedule(schedule);
		setRuns(listScheduleRuns(schedule.id, 10));
		setDetailIndex(0);
		setScreen("detail");
		setStatusMessage(undefined);
	}, []);

	const handleCreate = useCallback(() => {
		setIsCreating(true);
		setForm(DEFAULT_FORM);
		setFormFieldIndex(0);
		setEditingField(null);
		setScreen("create");
		setStatusMessage(undefined);
	}, []);

	const handleEdit = useCallback(() => {
		if (!selectedSchedule) return;
		setIsCreating(false);
		setForm({
			name: selectedSchedule.name,
			prompt: selectedSchedule.prompt,
			personaName: selectedSchedule.personaName,
			cronExpression: selectedSchedule.cronExpression,
			enabled: selectedSchedule.enabled,
		});
		setFormFieldIndex(0);
		setEditingField(null);
		setScreen("edit");
		setStatusMessage(undefined);
	}, [selectedSchedule]);

	const handleBack = useCallback(() => {
		if (editingField) {
			setEditingField(null);
			return;
		}
		if (screen === "runOutput") {
			setScreen("detail");
			setSelectedRun(null);
			return;
		}
		if (screen === "create" || screen === "edit") {
			setScreen(isCreating ? "list" : "detail");
			setEditingField(null);
			setStatusMessage(undefined);
			return;
		}
		setScreen("list");
		setSelectedSchedule(null);
		setStatusMessage(undefined);
	}, [editingField, screen, isCreating]);

	const handleSaveForm = useCallback(async () => {
		if (saving) return;
		if (!form.name.trim()) {
			setStatusMessage("Name is required.");
			return;
		}
		if (!form.prompt.trim()) {
			setStatusMessage("Prompt is required.");
			return;
		}
		try {
			setSaving(true);
			setStatusMessage("Converting schedule expression…");
			const cronExpr = await humanToCronAsync(form.cronExpression);
			if (!isValidCronExpression(cronExpr)) {
				setSaving(false);
				setStatusMessage("Invalid cron expression.");
				return;
			}

			if (isCreating) {
				const params: CreateScheduleParams = {
					name: form.name.trim(),
					prompt: form.prompt.trim(),
					personaName: form.personaName,
					cronExpression: cronExpr,
					enabled: form.enabled,
				};
				createSchedule(params);
				refreshSchedules();
				setScreen("list");
				setEditingField(null);
				setStatusMessage(undefined);
				setSaving(false);
				return;
			}

			if (selectedSchedule) {
				updateSchedule(selectedSchedule.id, {
					name: form.name.trim(),
					prompt: form.prompt.trim(),
					personaName: form.personaName,
					cronExpression: cronExpr,
					enabled: form.enabled,
				});
				refreshSchedules();
				const updated = listSchedules().find(
					(s) => s.id === selectedSchedule.id,
				);
				if (updated) {
					setSelectedSchedule(updated);
					setRuns(listScheduleRuns(updated.id, 10));
				}
				setScreen("detail");
				setEditingField(null);
				setStatusMessage(undefined);
			}
			setSaving(false);
		} catch (e) {
			setSaving(false);
			setStatusMessage(e instanceof Error ? e.message : "Failed to save.");
		}
	}, [form, isCreating, selectedSchedule, refreshSchedules, saving]);

	const handleFieldEditSubmit = useCallback(
		async (value: string) => {
			if (!editingField) return;

			if (editingField === "enabled") {
				setForm((f) => ({
					...f,
					enabled:
						value.toLowerCase() === "yes" || value === "true" || value === "1",
				}));
			} else if (editingField === "persona") {
				const match = personas.find(
					(p) => p.name.toLowerCase() === value.toLowerCase(),
				);
				setForm((f) => ({
					...f,
					personaName: match?.name ?? value,
				}));
			} else if (editingField === "cron") {
				try {
					setStatusMessage("Converting schedule expression…");
					const cronExpr = await humanToCronAsync(value);
					setForm((f) => ({ ...f, cronExpression: cronExpr }));
					setStatusMessage(undefined);
				} catch {
					setStatusMessage(
						'Invalid schedule expression. Try a cron format like "0 9 * * *" or natural language like "every weekday at 9am".',
					);
				}
			} else {
				setForm((f) => ({ ...f, [formFieldToKey(editingField)]: value }));
			}
			setEditingField(null);
		},
		[editingField, personas],
	);

	const handleRunNow = useCallback(async () => {
		if (!selectedSchedule || running) return;
		setRunning(true);
		setStatusMessage("Running schedule…");
		try {
			await executeSchedule(selectedSchedule);
			refreshSchedules();
			const updated = listSchedules().find((s) => s.id === selectedSchedule.id);
			if (updated) {
				setSelectedSchedule(updated);
				setRuns(listScheduleRuns(updated.id, 10));
			}
			setStatusMessage(undefined);
		} catch (e) {
			setStatusMessage(
				`Run failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		setRunning(false);
	}, [selectedSchedule, running, refreshSchedules]);

	const currentFormField = formFields[formFieldIndex] ?? "name";

	if (screen === "confirm" && confirmAction) {
		return (
			<ConfirmDialog
				message={confirmMsg}
				onConfirm={() => {
					confirmAction();
				}}
				onCancel={() => {
					setConfirmAction(null);
					setConfirmMsg("");
					setScreen("detail");
				}}
			/>
		);
	}

	if (screen === "runOutput" && selectedRun && selectedSchedule) {
		return (
			<RunOutputView
				run={selectedRun}
				scheduleName={selectedSchedule.name}
				onBack={handleBack}
			/>
		);
	}

	if (editingField) {
		const currentRaw = form[formFieldToKey(editingField)];
		const currentValue =
			typeof currentRaw === "boolean"
				? currentRaw
					? "yes"
					: "no"
				: String(currentRaw);
		const placeholder =
			editingField === "cron"
				? "e.g. every weekday at 9am, every hour on mondays, 0 9 * * *"
				: editingField === "persona"
					? personas.map((p) => p.name).join(", ")
					: undefined;

		return (
			<FieldEditor
				label={editingField.charAt(0).toUpperCase() + editingField.slice(1)}
				value={currentValue}
				placeholder={placeholder}
				multiline={editingField === "prompt"}
				onSubmit={handleFieldEditSubmit}
				onCancel={() => setEditingField(null)}
			/>
		);
	}

	if (screen === "create" || screen === "edit") {
		const currentFormField = formFields[formFieldIndex] ?? "name";
		return (
			<ScheduleForm
				form={form}
				selectedField={currentFormField}
				personas={personas}
				isCreating={isCreating}
				saving={saving}
				statusMessage={statusMessage}
				onFieldFocus={(field) => {
					const idx = formFields.indexOf(field);
					setFormFieldIndex(idx >= 0 ? idx : 0);
				}}
				onEditField={(field) => setEditingField(field)}
				onToggleEnabled={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
				onCyclePersona={() => {
					const idx = personas.findIndex((p) => p.name === form.personaName);
					const next = (idx + 1) % personas.length;
					const nextName = personas[next]?.name ?? form.personaName;
					setForm((f) => ({ ...f, personaName: nextName }));
				}}
				onSave={handleSaveForm}
				onBack={handleBack}
			/>
		);
	}

	if (screen === "detail" && selectedSchedule) {
		return (
			<ScheduleDetail
				schedule={selectedSchedule}
				runs={runs}
				selectedIndex={detailIndex}
				running={running}
				onSelect={setDetailIndex}
				onEdit={handleEdit}
				onDelete={() => {
					setConfirmMsg(`Delete schedule "${selectedSchedule.name}"?`);
					setConfirmAction(() => () => {
						deleteScheduleFromStore(selectedSchedule.id);
						refreshSchedules();
						setScreen("list");
						setSelectedSchedule(null);
						setSelectedIndex(0);
						setConfirmAction(null);
						setConfirmMsg("");
					});
					setScreen("confirm");
				}}
				onRunNow={handleRunNow}
				onViewRun={(run) => {
					setSelectedRun(run);
					setScreen("runOutput");
				}}
				onBack={handleBack}
			/>
		);
	}

	return (
		<ScheduleList
			schedules={schedules}
			selectedIndex={selectedIndex}
			onSelect={setSelectedIndex}
			onSelectSchedule={handleSelectSchedule}
			onCreate={handleCreate}
			onQuit={handleQuit}
		/>
	);
}

export function runSchedulesUI(): void {
	const profile = detectTerminalProfile();
	render(<SchedulesApp />, {
		kittyKeyboard: {
			mode: resolveKittyKeyboardMode(profile),
			flags: ["disambiguateEscapeCodes"],
		},
	});
}
