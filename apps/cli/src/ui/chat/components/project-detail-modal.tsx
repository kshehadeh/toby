import type { Project } from "@toby/core/projects/index";
import { Box, Text } from "ink";
import React from "react";
import { ViewModal } from "../../shared";
import { ACCENT } from "../constants";

interface FileListSectionProps {
	readonly title: string;
	readonly files: readonly string[];
	readonly emptyLabel: string;
	readonly width: number;
}

function FileListSection({
	title,
	files,
	emptyLabel,
	width,
}: FileListSectionProps) {
	return (
		<Box flexDirection="column" width={width}>
			<Text bold color={ACCENT} wrap="truncate-end">
				{title}
			</Text>
			{files.length === 0 ? (
				<Text dimColor>{emptyLabel}</Text>
			) : (
				files.map((f) => (
					<Text key={f} wrap="truncate-end">
						{"  "}
						<Text dimColor>•</Text> {f}
					</Text>
				))
			)}
		</Box>
	);
}

interface SkillListSectionProps {
	readonly skills: readonly string[];
	readonly width: number;
}

function SkillListSection({ skills, width }: SkillListSectionProps) {
	return (
		<Box flexDirection="column" width={width}>
			<Text bold color={ACCENT} wrap="truncate-end">
				Pinned skills
			</Text>
			{skills.length === 0 ? (
				<Text dimColor>None</Text>
			) : (
				skills.map((s) => (
					<Text key={s} wrap="truncate-end">
						{"  "}
						<Text dimColor>•</Text> {s}
					</Text>
				))
			)}
		</Box>
	);
}

interface IntegrationListSectionProps {
	readonly integrations: readonly string[];
	readonly width: number;
}

function IntegrationListSection({
	integrations,
	width,
}: IntegrationListSectionProps) {
	return (
		<Box flexDirection="column" width={width}>
			<Text bold color={ACCENT} wrap="truncate-end">
				Context integrations
			</Text>
			{integrations.length === 0 ? (
				<Text dimColor>None</Text>
			) : (
				integrations.map((i) => (
					<Text key={i} wrap="truncate-end">
						{"  "}
						<Text dimColor>•</Text> {i}
					</Text>
				))
			)}
		</Box>
	);
}

export interface ProjectDetailModalProps {
	readonly termCols: number;
	readonly project: Project;
	readonly contextFiles: readonly string[];
	readonly outputFiles: readonly string[];
	readonly isActive: boolean;
}

export function ProjectDetailModal({
	termCols,
	project,
	contextFiles,
	outputFiles,
	isActive,
}: ProjectDetailModalProps) {
	const contentWidth = Math.max(24, termCols - 4);

	return (
		<ViewModal termCols={termCols} borderColor={ACCENT}>
			<Box flexDirection="row" width={contentWidth} gap={1}>
				<Text bold wrap="truncate-end">
					{project.name}
				</Text>
				{isActive ? (
					<Text color="cyan" wrap="truncate-end">
						★ active
					</Text>
				) : null}
			</Box>
			<Box marginTop={0} flexDirection="column" width={contentWidth}>
				<Text dimColor wrap="truncate-end">
					{project.dir}
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column" gap={1} width={contentWidth}>
				<FileListSection
					title="Context files"
					files={contextFiles}
					emptyLabel="No context files"
					width={contentWidth}
				/>
				<FileListSection
					title="Output files"
					files={outputFiles}
					emptyLabel="No output files yet"
					width={contentWidth}
				/>
				<SkillListSection skills={project.skills} width={contentWidth} />
				<IntegrationListSection
					integrations={project.integrations}
					width={contentWidth}
				/>
			</Box>
			<Box marginTop={1} flexDirection="row" gap={2} width={contentWidth}>
				<Text dimColor>a activate</Text>
				<Text dimColor>e edit</Text>
				<Text dimColor>Esc back</Text>
			</Box>
		</ViewModal>
	);
}
