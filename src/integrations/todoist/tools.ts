import { tool } from "ai";
import { z } from "zod";
import {
	type TodoistTaskCreateInput,
	type TodoistTaskUpdateInput,
	completeTask,
	createTask,
	fetchCompletedTasks,
	fetchOpenTasks,
	updateTask as submitTodoistTaskUpdate,
} from "./client";

interface TodoistToolContext {
	dryRun: boolean;
	appliedActions: string[];
}

export function createTodoistTools(ctx: TodoistToolContext) {
	return {
		fetchOpenTasks: tool({
			description:
				"Fetch active (incomplete) Todoist tasks via the tasks list API — not completed archive",
			inputSchema: z.object({
				limit: z.number().optional().describe("Maximum tasks to return"),
			}),
			execute: async ({ limit }) => {
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would fetch open Todoist tasks." };
				}

				const tasks = await fetchOpenTasks(limit ?? 30);
				return { tasks };
			},
		}),

		fetchCompletedTasks: tool({
			description: "Fetch recently completed Todoist tasks",
			inputSchema: z.object({
				limit: z
					.number()
					.optional()
					.describe("Maximum completed tasks to return"),
			}),
			execute: async ({ limit }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would fetch completed Todoist tasks.",
					};
				}

				const tasks = await fetchCompletedTasks(limit ?? 30);
				return { tasks };
			},
		}),

		completeTask: tool({
			description: "Mark a Todoist task as completed",
			inputSchema: z.object({
				taskId: z.string().describe("Todoist task id"),
			}),
			execute: async ({ taskId }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would complete Todoist task "${taskId}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				await completeTask(taskId);
				const msg = `Completed Todoist task "${taskId}"`;
				ctx.appliedActions.push(msg);
				return { success: true, taskId };
			},
		}),

		createTask: tool({
			description:
				"Create a new Todoist task in the inbox unless projectId or sectionId is set. Use projectId/sectionId from fetchOpenTasks context when the user wants a task in a specific project.",
			inputSchema: z.object({
				content: z
					.string()
					.min(1)
					.describe("Task title (what shows in the list)"),
				description: z
					.string()
					.optional()
					.describe("Optional longer description / notes"),
				projectId: z
					.string()
					.optional()
					.describe("Todoist project id (omit for default Inbox)"),
				sectionId: z
					.string()
					.optional()
					.describe("Todoist section id within a project"),
				parentTaskId: z
					.string()
					.optional()
					.describe("Parent task id for a sub-task"),
				dueDate: z
					.string()
					.optional()
					.describe("Due date in YYYY-MM-DD format"),
				dueString: z
					.string()
					.optional()
					.describe("Natural language due, e.g. tomorrow at 5pm"),
				priority: z.number().int().min(1).max(4).optional(),
			}),
			execute: async ({
				content,
				description,
				projectId,
				sectionId,
				parentTaskId,
				dueDate,
				dueString,
				priority,
			}) => {
				const payload: TodoistTaskCreateInput = {
					content,
					description,
					projectId,
					sectionId,
					parentTaskId,
					dueDate,
					dueString,
					priority: priority as 1 | 2 | 3 | 4 | undefined,
				};

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would create Todoist task: ${content}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, payload };
				}

				const created = await createTask(payload);
				const msg = `Created Todoist task "${created.content}" (${created.id})`;
				ctx.appliedActions.push(msg);
				return {
					success: true,
					taskId: created.id,
					url: created.url,
					content: created.content,
				};
			},
		}),

		updateTask: tool({
			description:
				"Update an existing Todoist task by id. Change the list title (`content` or `title`), notes (`description`), due date (`dueDate` YYYY-MM-DD, `dueString` natural language, or `dueDatetime` ISO 8601), `priority` (1–4, 4 = most urgent in API), and/or `labels`. Pass at least one field besides taskId.",
			inputSchema: z.object({
				taskId: z
					.string()
					.describe("Todoist task id from fetchOpenTasks or context"),
				content: z
					.string()
					.optional()
					.describe("New task title / list text (Todoist content field)"),
				title: z
					.string()
					.optional()
					.describe("Alias for content when only renaming the task"),
				description: z
					.string()
					.optional()
					.describe(
						"Task description / notes (empty string clears if supported)",
					),
				dueDate: z
					.string()
					.optional()
					.describe("Due date in YYYY-MM-DD format"),
				dueString: z
					.string()
					.optional()
					.describe("Natural language due, e.g. tomorrow at 5pm"),
				dueDatetime: z
					.string()
					.optional()
					.describe("Due as ISO 8601 date-time when you need a specific time"),
				priority: z.number().int().min(1).max(4).optional(),
				labels: z
					.array(z.string())
					.optional()
					.describe(
						"Label names to set on the task (replaces labels on the task)",
					),
			}),
			execute: async ({
				taskId,
				content,
				title,
				description,
				dueDate,
				dueString,
				dueDatetime,
				priority,
				labels,
			}) => {
				const contentResolved = content ?? title;
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
						error:
							"Provide at least one of: content, title, description, dueDate, dueString, dueDatetime, priority, or labels.",
					};
				}

				const updates: TodoistTaskUpdateInput = {
					content: contentResolved,
					description,
					dueDate,
					dueString,
					dueDatetime,
					priority: priority as 1 | 2 | 3 | 4 | undefined,
					labels,
				};

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would update Todoist task "${taskId}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, updates };
				}

				await submitTodoistTaskUpdate(taskId, updates);
				const msg = `Updated Todoist task "${taskId}"`;
				ctx.appliedActions.push(msg);
				return { success: true, taskId };
			},
		}),
	};
}
