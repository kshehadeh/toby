import { api } from "@/api/client";
import { ConfigureBooleanSwitch } from "@/components/ConfigureBooleanSwitch";
import { ConfigureSelect } from "@/components/ConfigureSelect";
import { ConfigureSettingRow } from "@/components/ConfigureSettingRow";
import { ConfirmDialog, deleteConfirmCopy } from "@/components/ConfirmDialog";
import { DefaultProviderCard } from "@/components/DefaultProviderCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { isBooleanSelectField } from "@/lib/boolean-select-field";
import { cn } from "@/lib/utils";
import type { SettingsItem } from "@/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

const CONFIGURE_CARD_WIDTH = "w-[32rem]";
const CONFIGURE_CARD_WIDTH_WIDE = "w-[44rem]";

/** Placeholder the API returns for configured secrets ("unchanged"). */
const REDACTED_SECRET = "••••••";

interface ConfigureDetailProps {
	section: SettingsItem;
	values: Record<string, string>;
	isContainer?: boolean;
	integrationLabels?: Record<string, string>;
}

function isEditableField(field: SettingsItem): boolean {
	if (field.readOnly) return false;
	if (
		field.kind === "hint" ||
		field.kind === "action" ||
		field.kind === "delete"
	) {
		return false;
	}
	return field.kind === "value" || field.kind === "select";
}

interface PendingDelete {
	action: string;
	body: Record<string, string>;
	title: string;
	message: string;
	confirmLabel: string;
}

export function ConfigureDetail({
	section,
	values,
	isContainer = false,
	integrationLabels,
}: ConfigureDetailProps) {
	const queryClient = useQueryClient();
	const sectionKey = section.navKey ?? section.key;
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
		null,
	);

	useEffect(() => {
		setDraft({});
		setPendingDelete(null);
	}, [sectionKey]);

	const patchMutation = useMutation({
		mutationFn: (changes: Record<string, string>) =>
			api.patchConfigure(changes),
		onSuccess: () => {
			setDraft({});
			queryClient.invalidateQueries({ queryKey: ["configure-tree"] });
		},
	});

	const actionMutation = useMutation({
		mutationFn: ({
			action,
			body,
		}: {
			action: string;
			body: Record<string, string>;
		}) => api.configureAction(action, body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["configure-tree"] });
		},
	});

	const getValue = (key: string) => draft[key] ?? values[key] ?? "";

	const runAction = (action: string, body: Record<string, string>) => {
		actionMutation.mutate({ action, body });
	};

	const requestDelete = (field: SettingsItem) => {
		const action = actionForKey(field.key);
		if (!action) return;
		const { title, message } = deleteConfirmCopy(field.label, section.label);
		setPendingDelete({
			action: action.name,
			body: action.body,
			title,
			message,
			confirmLabel: field.label,
		});
	};

	const confirmDelete = () => {
		if (!pendingDelete) return;
		runAction(pendingDelete.action, pendingDelete.body);
		setPendingDelete(null);
	};

	const saving = patchMutation.isPending || actionMutation.isPending;

	const fields = (section.children ?? []).filter(
		(c) =>
			!(c.kind === "section" && (c.children?.length ?? 0) > 0) &&
			!(c.kind === "hint" && c.key.endsWith("._empty")),
	);

	const deleteFields = fields.filter((f) => f.kind === "delete");
	const mainFields = fields.filter((f) => f.kind !== "delete");
	const editableFields = mainFields.filter(isEditableField);

	const pendingChanges = useMemo(() => {
		const changes: Record<string, string> = {};
		for (const field of editableFields) {
			if (field.masked) {
				// Secrets are write-only: only send a value the user actually typed.
				// Leaving the field untouched keeps the existing secret intact.
				const typed = draft[field.key];
				if (typed !== undefined && typed !== "" && typed !== REDACTED_SECRET) {
					changes[field.key] = typed;
				}
				continue;
			}
			const current = draft[field.key] ?? values[field.key] ?? "";
			const saved = values[field.key] ?? "";
			if (current !== saved) {
				changes[field.key] = current;
			}
		}
		return changes;
	}, [draft, values, editableFields]);

	const hasChanges = Object.keys(pendingChanges).length > 0;

	const handleSave = () => {
		if (!hasChanges) return;
		patchMutation.mutate(pendingChanges);
	};

	const showFooter = editableFields.length > 0 || deleteFields.length > 0;
	const isDefaultProvidersSection = section.key === "defaults";

	return (
		<>
			<Card
				className={cn(
					"mx-auto max-w-full ring-0 shadow-none",
					isDefaultProvidersSection
						? CONFIGURE_CARD_WIDTH_WIDE
						: CONFIGURE_CARD_WIDTH,
				)}
			>
				<CardHeader className="pb-4">
					<CardTitle className="text-xl">{section.label}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-5">
					{isContainer && (
						<p className="text-muted-foreground text-sm">
							Select an item in the sidebar to view and edit its settings.
						</p>
					)}

					{isDefaultProvidersSection ? (
						<div className="grid gap-4 sm:grid-cols-2">
							{mainFields.map((field) => (
								<DefaultProviderCard
									key={field.navKey ?? field.key}
									field={field}
									value={getValue(field.key)}
									onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
									disabled={saving}
									integrationLabels={integrationLabels}
								/>
							))}
						</div>
					) : (
						mainFields.map((field) => (
							<ConfigureFieldRow
								key={field.navKey ?? field.key}
								field={field}
								value={getValue(field.key)}
								onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
								onAction={runAction}
								saving={saving}
								integrationLabels={integrationLabels}
							/>
						))
					)}

					{showFooter && (
						<>
							<Separator />
							<div className="flex flex-wrap items-center gap-2 pt-2">
								{editableFields.length > 0 && (
									<Button onClick={handleSave} disabled={saving || !hasChanges}>
										Save
									</Button>
								)}
								{deleteFields.map((field) => (
									<ConfigureFieldRow
										key={field.navKey ?? field.key}
										field={field}
										value={getValue(field.key)}
										onChange={() => {}}
										onAction={runAction}
										onDeleteRequest={requestDelete}
										saving={saving}
									/>
								))}
							</div>
						</>
					)}
				</CardContent>
			</Card>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
				title={pendingDelete?.title ?? ""}
				message={pendingDelete?.message ?? ""}
				confirmLabel={pendingDelete?.confirmLabel ?? "Delete"}
				confirmVariant="destructive"
				disabled={saving}
				onConfirm={confirmDelete}
			/>
		</>
	);
}

function ConfigureFieldRow({
	field,
	value,
	onChange,
	onAction,
	onDeleteRequest,
	saving,
	integrationLabels,
}: {
	field: SettingsItem;
	value: string;
	onChange: (v: string) => void;
	onAction: (action: string, body: Record<string, string>) => void;
	onDeleteRequest?: (field: SettingsItem) => void;
	saving: boolean;
	integrationLabels?: Record<string, string>;
}) {
	if (field.kind === "hint") {
		return (
			<div className="space-y-2">
				<Label className="text-muted-foreground">{field.label}</Label>
				<p className="text-sm whitespace-pre-wrap leading-relaxed">
					{field.currentValue ?? value}
				</p>
			</div>
		);
	}

	if (field.kind === "action") {
		const action = actionForKey(field.key);
		if (!action) return null;
		return (
			<Button
				variant="outline"
				disabled={saving}
				onClick={() => onAction(action.name, action.body)}
			>
				{field.label}
			</Button>
		);
	}

	if (field.kind === "delete") {
		if (!onDeleteRequest || !actionForKey(field.key)) return null;
		return (
			<Button
				variant="destructive"
				disabled={saving}
				onClick={() => onDeleteRequest(field)}
			>
				{field.label}
			</Button>
		);
	}

	if (field.readOnly) {
		return (
			<div className="space-y-2">
				<Label>{field.label}</Label>
				<Badge variant="secondary">
					{value === REDACTED_SECRET || value ? "Configured" : "Not set"}
				</Badge>
			</div>
		);
	}

	if (field.masked) {
		const configured = value === REDACTED_SECRET;
		// Start empty so the user types a fresh secret; the redacted placeholder
		// is never shown as editable text.
		const displayValue = configured ? "" : value;
		return (
			<div className="space-y-2">
				<Label>{field.label}</Label>
				<Input
					type="password"
					autoComplete="off"
					className="w-full"
					placeholder={
						configured
							? "Configured — enter a new value to replace"
							: "Enter value"
					}
					value={displayValue}
					onChange={(e) => onChange(e.target.value)}
				/>
				{configured ? (
					<p className="text-muted-foreground text-xs">
						A value is saved. Leave blank to keep it unchanged.
					</p>
				) : null}
			</div>
		);
	}

	if (field.kind === "select" && field.options?.length) {
		if (isBooleanSelectField(field)) {
			return (
				<ConfigureBooleanSwitch
					field={field}
					value={value}
					onChange={onChange}
					disabled={saving}
				/>
			);
		}

		return (
			<ConfigureSettingRow label={field.label}>
				<ConfigureSelect
					field={field}
					value={value}
					onChange={onChange}
					disabled={saving}
					triggerClassName="w-44"
					integrationLabels={integrationLabels}
				/>
			</ConfigureSettingRow>
		);
	}

	return (
		<div className="space-y-2">
			<Label>{field.label}</Label>
			{field.multiline ? (
				<Textarea
					className="min-h-28 font-mono text-sm"
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<Input
					className="w-full"
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}
		</div>
	);
}

function actionForKey(
	key: string,
): { name: string; body: Record<string, string> } | null {
	if (key === "personas._new") return { name: "create-persona", body: {} };
	const setDefault = /^personas\.(.+)\._setDefault$/.exec(key);
	if (setDefault)
		return {
			name: "set-default-persona",
			body: { personaName: setDefault[1] },
		};
	const deletePersona = /^personas\.(.+)\._delete$/.exec(key);
	if (deletePersona)
		return {
			name: "delete-persona",
			body: { personaName: deletePersona[1] },
		};
	const deleteSkill = /^skills\.(.+)\._delete$/.exec(key);
	if (deleteSkill)
		return { name: "delete-skill", body: { dirName: deleteSkill[1] } };
	if (key === "schedules._new") return { name: "create-schedule", body: {} };
	const deleteSchedule = /^schedules\.(.+)\._delete$/.exec(key);
	if (deleteSchedule)
		return {
			name: "delete-schedule",
			body: { scheduleId: deleteSchedule[1] },
		};
	return null;
}
