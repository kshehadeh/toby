import { tool } from "ai";
import { z } from "zod";
import {
	type TodoistTaskUpdateInput,
	completeTask,
	fetchCompletedTasks,
	fetchOpenTasks,
	updateTask,
} from "./client";

interface TodoistToolContext {
	dryRun: boolean;
	appliedActions: string[];
}

export function createTodoistTools(ctx: TodoistToolContext) {
	return {
		fetchOpenTasks: tool({
			description: "Fetch open Todoist tasks",
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

		updateTaskData: tool({
			description:
				"Update a Todoist task (content, description, due date/string, priority)",
			inputSchema: z.object({
				taskId: z.string().describe("Todoist task id"),
				content: z.string().optional(),
				description: z.string().optional(),
				dueDate: z
					.string()
					.optional()
					.describe("Due date in YYYY-MM-DD format"),
				dueString: z
					.string()
					.optional()
					.describe("Natural language due string, e.g. tomorrow at 5pm"),
				priority: z.number().int().min(1).max(4).optional(),
			}),
			execute: async ({
				taskId,
				content,
				description,
				dueDate,
				dueString,
				priority,
			}) => {
				const updates: TodoistTaskUpdateInput = {
					content,
					description,
					dueDate,
					dueString,
					priority: priority as 1 | 2 | 3 | 4 | undefined,
				};

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would update Todoist task "${taskId}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, updates };
				}

				await updateTask(taskId, updates);
				const msg = `Updated Todoist task "${taskId}"`;
				ctx.appliedActions.push(msg);
				return { success: true, taskId };
			},
		}),
	};
}
