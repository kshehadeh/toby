import {
	createProject,
	deleteProject,
	listProjectTree,
	listProjects,
	resolveProject,
	updateProjectMetadata,
} from "../../projects/index";
import {
	createChatSession,
	listChatSessionsForProject,
} from "../../session-store";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

function projectPayload(
	project: NonNullable<ReturnType<typeof resolveProject>>,
) {
	return {
		id: project.id,
		slug: project.slug,
		name: project.name,
		summary: project.summary,
		folderPath: project.folderPath,
		personaName: project.personaName,
		outputsDir: project.outputsDir,
		skillsDir: project.skillsDir,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
	};
}

export function handleProjectsList(): Response {
	return jsonResponse({ projects: listProjects().map(projectPayload) });
}

export async function handleCreateProject(req: Request): Promise<Response> {
	const body =
		(await readJsonBody<{
			name?: string;
			summary?: string;
			folderPath?: string;
			personaName?: string | null;
		}>(req)) ?? {};
	try {
		const project = createProject({
			name: body.name?.trim() || "New project",
			summary: body.summary ?? "",
			folderPath: body.folderPath,
			personaName: body.personaName ?? null,
		});
		return jsonResponse({ project: projectPayload(project) }, 201);
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function handleProjectDetail(projectId: string): Response {
	const project = resolveProject(projectId);
	if (!project) return errorResponse("Project not found", 404);
	const sessions = listChatSessionsForProject(project.id, 100);
	return jsonResponse({ project: projectPayload(project), sessions });
}

export async function handlePatchProject(
	projectId: string,
	req: Request,
): Promise<Response> {
	const body =
		(await readJsonBody<{
			name?: string;
			summary?: string;
			folderPath?: string;
			personaName?: string | null;
		}>(req)) ?? {};
	try {
		const project = updateProjectMetadata(projectId, {
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.summary !== undefined ? { summary: body.summary } : {}),
			...(body.folderPath !== undefined ? { folderPath: body.folderPath } : {}),
			...(body.personaName !== undefined
				? { personaName: body.personaName }
				: {}),
		});
		return jsonResponse({ project: projectPayload(project) });
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			404,
		);
	}
}

export function handleDeleteProject(projectId: string): Response {
	const project = resolveProject(projectId);
	if (!project) return errorResponse("Project not found", 404);
	deleteProject(project.id);
	return jsonResponse({ ok: true });
}

export function handleProjectTree(projectId: string): Response {
	const project = resolveProject(projectId);
	if (!project) return errorResponse("Project not found", 404);
	return jsonResponse({ tree: listProjectTree(project) });
}

export async function handleCreateProjectSession(
	projectId: string,
	req: Request,
): Promise<Response> {
	const project = resolveProject(projectId);
	if (!project) return errorResponse("Project not found", 404);
	const body =
		(await readJsonBody<{
			name?: string;
			persona?: string;
			modules?: readonly string[];
			dryRun?: boolean;
			debug?: boolean;
		}>(req)) ?? {};
	const session = createChatSession({
		name: body.name?.trim() || "New chat",
		settings: {
			projectId: project.id,
			...(body.persona ? { persona: body.persona } : {}),
			...(body.modules ? { modules: body.modules } : {}),
			...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
			...(body.debug !== undefined ? { debug: body.debug } : {}),
		},
	});
	return jsonResponse({ session }, 201);
}
