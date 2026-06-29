import {
	type TodoistTaskCreateInput,
	type TodoistTaskUpdateInput,
	completeTask,
	createTask,
	fetchCompletedTasks,
	fetchOpenTasks,
	fetchProjectNameById,
	fetchProjects,
	updateTask as submitTodoistTaskUpdate,
} from "./client";

type JsonRecord = Record<string, unknown>;

export const TOOL_DEFINITIONS = [
	{
		name: "fetchOpenTasks",
		displayName: "Fetch open tasks",
		description:
			"Fetch active (incomplete) Todoist tasks via the tasks list API — not completed archive",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					description: "Maximum tasks to return",
				},
			},
		},
	},
	{
		name: "fetchCompletedTasks",
		displayName: "Fetch completed tasks",
		description: "Fetch recently completed Todoist tasks",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					description: "Maximum completed tasks to return",
				},
			},
		},
	},
	{
		name: "listProjectNames",
		displayName: "List project names",
		description:
			"List Todoist project names (includes project id so you can map task.projectId values).",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "getProjectNameById",
		displayName: "Resolve project name",
		description:
			"Convert a Todoist project id to a project name. Use this when context includes only projectId values.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				projectId: {
					type: "string",
					description: "Todoist project id",
				},
			},
			required: ["projectId"],
		},
	},
	{
		name: "completeTask",
		displayName: "Complete task",
		description: "Mark a Todoist task as completed",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: "Todoist task id",
				},
			},
			required: ["taskId"],
		},
	},
	{
		name: "createTask",
		displayName: "Create task",
		description:
			"Create a new Todoist task in the inbox unless projectId or sectionId is set. Use projectId/sectionId from fetchOpenTasks context when the user wants a task in a specific project.",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				content: {
					type: "string",
					minLength: 1,
					description: "Task title (what shows in the list)",
				},
				description: {
					type: "string",
					description: "Optional longer description / notes",
				},
				projectId: {
					type: "string",
					description: "Todoist project id (omit for default Inbox)",
				},
				sectionId: {
					type: "string",
					description: "Todoist section id within a project",
				},
				parentTaskId: {
					type: "string",
					description: "Parent task id for a sub-task",
				},
				dueDate: {
					type: "string",
					description: "Due date in YYYY-MM-DD format",
				},
				dueString: {
					type: "string",
					description: "Natural language due, e.g. tomorrow at 5pm",
				},
				priority: {
					type: "integer",
					minimum: 1,
					maximum: 4,
				},
			},
			required: ["content"],
		},
	},
	{
		name: "updateTask",
		displayName: "Update task",
		description:
			"Update an existing Todoist task by id. Change the list title (`content` or `title`), notes (`description`), due date (`dueDate` YYYY-MM-DD, `dueString` natural language, or `dueDatetime` ISO 8601), `priority` (1–4, 4 = most urgent in API), and/or `labels`. Pass at least one field besides taskId.",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: "Todoist task id from fetchOpenTasks or context",
				},
				content: {
					type: "string",
					description: "New task title / list text (Todoist content field)",
				},
				title: {
					type: "string",
					description: "Alias for content when only renaming the task",
				},
				description: {
					type: "string",
					description:
						"Task description / notes (empty string clears if supported)",
				},
				dueDate: {
					type: "string",
					description: "Due date in YYYY-MM-DD format",
				},
				dueString: {
					type: "string",
					description: "Natural language due, e.g. tomorrow at 5pm",
				},
				dueDatetime: {
					type: "string",
					description:
						"Due as ISO 8601 date-time when you need a specific time",
				},
				priority: {
					type: "integer",
					minimum: 1,
					maximum: 4,
				},
				labels: {
					type: "array",
					items: { type: "string" },
					description:
						"Label names to set on the task (replaces labels on the task)",
				},
			},
			required: ["taskId"],
		},
	},
];

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
): Promise<{ result: unknown; appliedActions?: string[] }> {
	const appliedActions: string[] = [];

	switch (tool) {
		case "fetchOpenTasks": {
			const limit = typeof input.limit === "number" ? input.limit : undefined;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would fetch open Todoist tasks.",
					},
				};
			}
			const tasks = await fetchOpenTasks(config, limit ?? 30);
			return { result: { tasks } };
		}

		case "fetchCompletedTasks": {
			const limit = typeof input.limit === "number" ? input.limit : undefined;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would fetch completed Todoist tasks.",
					},
				};
			}
			const tasks = await fetchCompletedTasks(config, limit ?? 30);
			return { result: { tasks } };
		}

		case "listProjectNames": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would list Todoist project names.",
					},
				};
			}
			const projects = await fetchProjects(config);
			return {
				result: {
					projectNames: projects.map((project) => project.name),
					projects,
				},
			};
		}

		case "getProjectNameById": {
			const projectId = String(input.projectId ?? "");
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would resolve Todoist project id "${projectId}" to a project name.`,
					},
				};
			}
			const projectName = await fetchProjectNameById(config, projectId);
			return {
				result: {
					projectId,
					projectName,
					found: projectName !== null,
				},
			};
		}

		case "completeTask": {
			const taskId = String(input.taskId ?? "");
			if (dryRun) {
				const msg = `[DRY RUN] Would complete Todoist task "${taskId}"`;
				appliedActions.push(msg);
				return { result: { dryRun: true, message: msg }, appliedActions };
			}
			await completeTask(config, taskId);
			const msg = `Completed Todoist task "${taskId}"`;
			appliedActions.push(msg);
			return { result: { success: true, taskId }, appliedActions };
		}

		case "createTask": {
			const payload: TodoistTaskCreateInput = {
				content: String(input.content ?? ""),
				description:
					input.description !== undefined
						? String(input.description)
						: undefined,
				projectId:
					input.projectId !== undefined ? String(input.projectId) : undefined,
				sectionId:
					input.sectionId !== undefined ? String(input.sectionId) : undefined,
				parentTaskId:
					input.parentTaskId !== undefined
						? String(input.parentTaskId)
						: undefined,
				dueDate:
					input.dueDate !== undefined ? String(input.dueDate) : undefined,
				dueString:
					input.dueString !== undefined ? String(input.dueString) : undefined,
				priority:
					typeof input.priority === "number"
						? (input.priority as 1 | 2 | 3 | 4)
						: undefined,
			};

			if (dryRun) {
				const msg = `[DRY RUN] Would create Todoist task: ${payload.content}`;
				appliedActions.push(msg);
				return {
					result: { dryRun: true, message: msg, payload },
					appliedActions,
				};
			}

			const created = await createTask(config, payload);
			const msg = `Created Todoist task "${created.content}" (${created.id})`;
			appliedActions.push(msg);
			return {
				result: {
					success: true,
					taskId: created.id,
					url: created.url,
					content: created.content,
				},
				appliedActions,
			};
		}

		case "updateTask": {
			const taskId = String(input.taskId ?? "");
			const contentResolved =
				input.content !== undefined
					? String(input.content)
					: input.title !== undefined
						? String(input.title)
						: undefined;
			const description =
				input.description !== undefined ? String(input.description) : undefined;
			const dueDate =
				input.dueDate !== undefined ? String(input.dueDate) : undefined;
			const dueString =
				input.dueString !== undefined ? String(input.dueString) : undefined;
			const dueDatetime =
				input.dueDatetime !== undefined ? String(input.dueDatetime) : undefined;
			const priority =
				typeof input.priority === "number"
					? (input.priority as 1 | 2 | 3 | 4)
					: undefined;
			const labels = Array.isArray(input.labels)
				? input.labels.map(String)
				: undefined;

			const hasChange =
				contentResolved !== undefined ||
				description !== undefined ||
				dueDate !== undefined ||
				dueString !== undefined ||
				dueDatetime !== undefined ||
				priority !== undefined ||
				(labels !== undefined && labels.length > 0);

			if (!hasChange) {
				return {
					result: {
						error:
							"Provide at least one of: content, title, description, dueDate, dueString, dueDatetime, priority, or labels.",
					},
				};
			}

			const updates: TodoistTaskUpdateInput = {
				content: contentResolved,
				description,
				dueDate,
				dueString,
				dueDatetime,
				priority,
				labels,
			};

			if (dryRun) {
				const msg = `[DRY RUN] Would update Todoist task "${taskId}"`;
				appliedActions.push(msg);
				return {
					result: { dryRun: true, message: msg, updates },
					appliedActions,
				};
			}

			await submitTodoistTaskUpdate(config, taskId, updates);
			const msg = `Updated Todoist task "${taskId}"`;
			appliedActions.push(msg);
			return { result: { success: true, taskId }, appliedActions };
		}

		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
