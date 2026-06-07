import { TodoistApi } from "@doist/todoist-sdk";
import type { AddTaskArgs, Task, UpdateTaskArgs } from "@doist/todoist-sdk";
import { withRetry } from "./rate-limit";

type JsonRecord = Record<string, unknown>;

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	priority: number;
	projectId: string;
	sectionId: string | null;
	due: {
		date?: string;
		datetime?: string;
		string?: string;
	} | null;
	url: string;
}

export interface TodoistCompletedTask {
	taskId: string;
	content: string;
	completedAt: string;
	projectId: string | null;
}

export interface TodoistProject {
	id: string;
	name: string;
	isInboxProject: boolean;
}

const COMPLETED_FETCH_PAGE_MAX = 200;
const COMPLETED_FETCH_MAX_PAGES = 100;

export interface TodoistTaskUpdateInput {
	content?: string;
	description?: string;
	dueDate?: string;
	dueString?: string;
	dueDatetime?: string;
	priority?: 1 | 2 | 3 | 4;
	labels?: string[];
}

export interface TodoistTaskCreateInput {
	readonly content: string;
	readonly description?: string;
	readonly projectId?: string;
	readonly sectionId?: string;
	readonly parentTaskId?: string;
	readonly dueDate?: string;
	readonly dueString?: string;
	readonly priority?: 1 | 2 | 3 | 4;
}

export function hasTodoistApiKey(config: JsonRecord): boolean {
	return Boolean(String(config.apiKey ?? "").trim());
}

export function normalizeConfig(config: JsonRecord): JsonRecord {
	return {
		apiKey: String(config.apiKey ?? "").trim(),
	};
}

export async function testTodoistConnection(config: JsonRecord): Promise<void> {
	const api = getTodoistApiClient(config);
	await api.getProjects({ limit: 1 });
}

const TASKS_PAGE_MAX = 200;
const TASKS_FETCH_MAX_PAGES = 100;

function isActiveOpenTaskRow(task: Task): boolean {
	if (task.isDeleted === true) {
		return false;
	}
	if (task.checked === true) {
		return false;
	}
	return true;
}

export async function fetchOpenTasks(
	config: JsonRecord,
	limit?: number,
): Promise<TodoistTask[]> {
	const api = getTodoistApiClient(config);
	const collected: TodoistTask[] = [];
	let cursor: string | null = null;

	for (
		let page = 0;
		page < TASKS_FETCH_MAX_PAGES &&
		(limit === undefined || collected.length < limit);
		page++
	) {
		const pageLimit =
			limit === undefined
				? TASKS_PAGE_MAX
				: Math.min(TASKS_PAGE_MAX, Math.max(1, limit - collected.length));
		const response = await api.getTasks({
			...(cursor ? { cursor } : {}),
			limit: pageLimit,
		});
		const results = response.results ?? [];
		const nextCursor = response.nextCursor ?? null;
		for (const task of results) {
			if (isActiveOpenTaskRow(task)) {
				collected.push(mapSdkTaskToTodoistTask(task));
			}
		}
		if (!nextCursor || results.length === 0) {
			break;
		}
		cursor = nextCursor;
	}

	return limit === undefined ? collected : collected.slice(0, limit);
}

export async function fetchCompletedTasks(
	config: JsonRecord,
	limit?: number,
): Promise<TodoistCompletedTask[]> {
	const api = getTodoistApiClient(config);
	const until = new Date();
	const since = new Date(until);
	since.setDate(since.getDate() - 30);

	const collected: TodoistCompletedTask[] = [];
	let cursor: string | null = null;

	for (
		let page = 0;
		page < COMPLETED_FETCH_MAX_PAGES &&
		(limit === undefined || collected.length < limit);
		page++
	) {
		const pageLimit =
			limit === undefined
				? COMPLETED_FETCH_PAGE_MAX
				: Math.min(
						COMPLETED_FETCH_PAGE_MAX,
						Math.max(1, limit - collected.length),
					);

		const response = await api.getCompletedTasksByCompletionDate({
			since: since.toISOString(),
			until: until.toISOString(),
			limit: pageLimit,
			...(cursor ? { cursor } : {}),
		});
		const items = response.items ?? [];
		for (const task of items) {
			if (limit !== undefined && collected.length >= limit) {
				break;
			}
			collected.push({
				taskId: task.id,
				content: task.content,
				completedAt: task.completedAt?.toISOString() ?? "",
				projectId: task.projectId ?? null,
			});
		}

		cursor = response.nextCursor ?? null;
		if (!cursor || items.length === 0) {
			break;
		}
	}

	return limit === undefined ? collected : collected.slice(0, limit);
}

export async function fetchProjects(
	config: JsonRecord,
): Promise<TodoistProject[]> {
	const api = getTodoistApiClient(config);
	const collected: TodoistProject[] = [];
	let cursor: string | null = null;

	for (let page = 0; page < TASKS_FETCH_MAX_PAGES; page++) {
		const response = await api.getProjects({
			...(cursor ? { cursor } : {}),
			limit: TASKS_PAGE_MAX,
		});
		const projects = response.results ?? [];
		for (const project of projects) {
			collected.push({
				id: project.id,
				name: project.name,
				isInboxProject:
					"inboxProject" in project && project.inboxProject === true,
			});
		}
		cursor = response.nextCursor ?? null;
		if (!cursor || projects.length === 0) {
			break;
		}
	}

	return collected;
}

export async function fetchProjectNameById(
	config: JsonRecord,
	projectId: string,
): Promise<string | null> {
	const api = getTodoistApiClient(config);
	const normalizedProjectId = projectId.trim();
	if (!normalizedProjectId) {
		return null;
	}
	try {
		const project = await api.getProject(normalizedProjectId);
		return project.name;
	} catch (error) {
		if (isTodoistNotFoundError(error)) {
			return null;
		}
		throw error;
	}
}

export async function createTask(
	config: JsonRecord,
	input: TodoistTaskCreateInput,
): Promise<{ id: string; url: string; content: string }> {
	const api = getTodoistApiClient(config);
	const body = {
		content: input.content,
		...(input.description !== undefined && input.description !== ""
			? { description: input.description }
			: {}),
		...(input.projectId !== undefined && input.projectId !== ""
			? { projectId: input.projectId }
			: {}),
		...(input.sectionId !== undefined && input.sectionId !== ""
			? { sectionId: input.sectionId }
			: {}),
		...(input.parentTaskId !== undefined && input.parentTaskId !== ""
			? { parentId: input.parentTaskId }
			: {}),
		...(input.dueDate !== undefined && input.dueDate !== ""
			? { dueDate: input.dueDate }
			: {}),
		...(input.dueString !== undefined && input.dueString !== ""
			? { dueString: input.dueString }
			: {}),
		...(input.priority !== undefined ? { priority: input.priority } : {}),
	};

	const created = await withRetry(() => api.addTask(body as AddTaskArgs));
	const id = created.id;
	const url = created.url ?? "";
	const content = created.content ?? input.content;
	return { id, url, content };
}

export async function completeTask(
	config: JsonRecord,
	taskId: string,
): Promise<void> {
	const api = getTodoistApiClient(config);
	await withRetry(() => api.closeTask(taskId));
}

export async function updateTask(
	config: JsonRecord,
	taskId: string,
	updates: TodoistTaskUpdateInput,
): Promise<void> {
	const api = getTodoistApiClient(config);
	const requestBody: Record<string, unknown> = {
		...(updates.content !== undefined ? { content: updates.content } : {}),
		...(updates.description !== undefined
			? { description: updates.description }
			: {}),
		...(updates.priority !== undefined ? { priority: updates.priority } : {}),
		...(updates.labels !== undefined && updates.labels.length > 0
			? { labels: updates.labels }
			: {}),
	};
	if (updates.dueDatetime !== undefined && updates.dueDatetime !== "") {
		requestBody.dueDatetime = updates.dueDatetime;
	} else if (updates.dueDate !== undefined && updates.dueDate !== "") {
		requestBody.dueDate = updates.dueDate;
	} else if (updates.dueString !== undefined && updates.dueString !== "") {
		requestBody.dueString = updates.dueString;
	}
	await withRetry(() => api.updateTask(taskId, requestBody as UpdateTaskArgs));
}

function getTodoistApiClient(config: JsonRecord): TodoistApi {
	const apiKey = String(config.apiKey ?? "").trim();
	if (!apiKey) {
		throw new Error(
			"Todoist API key not found. Add it in `toby configure` or run `toby connect todoist`.",
		);
	}
	return new TodoistApi(apiKey);
}

function mapSdkTaskToTodoistTask(task: Task): TodoistTask {
	return {
		id: task.id,
		content: task.content,
		description: task.description ?? "",
		priority: task.priority,
		projectId: task.projectId,
		sectionId: task.sectionId ?? null,
		due: task.due
			? {
					date: task.due.date,
					datetime: task.due.datetime ?? undefined,
					string: task.due.string,
				}
			: null,
		url: task.url,
	};
}

function isTodoistNotFoundError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const msg = error.message.toLowerCase();
	return msg.includes("404") || msg.includes("not found");
}
