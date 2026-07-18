import "./definitions/dashboard-email-summary";
import "./definitions/dashboard-tasks-summary";
import "./definitions/dashboard-calendar-summary";

export type {
	FlowContextBag,
	FlowDefinition,
	FlowInputMap,
	FlowInputSource,
	FlowNodeDefinition,
	FlowNodePromptContext,
	FlowNodeTrace,
	FlowOutputMap,
	FlowResult,
	FlowRunOptions,
	LlmPrompterNodeDefinition,
	ToolExecutorNodeDefinition,
	ToolRef,
} from "./types";
export { FlowNodeError } from "./types";

export {
	clearFlowRegistry,
	getFlow,
	listFlows,
	registerFlow,
} from "./registry";

export { runFlow, runFlowDefinition } from "./runner";

export {
	getByPath,
	resolveNodeInputs,
	applyNodeOutputs,
} from "./resolve-inputs";

export {
	executeNamedTool,
	executeToolRef,
	resolveNamedTool,
	resolveStandardTool,
} from "./tool-resolve";
export type { ExecuteToolResult, ResolvedToolTarget } from "./tool-resolve";

export { emailDashboardSummaryFlow } from "./definitions/dashboard-email-summary";
export { tasksDashboardSummaryFlow } from "./definitions/dashboard-tasks-summary";
export { calendarDashboardSummaryFlow } from "./definitions/dashboard-calendar-summary";
