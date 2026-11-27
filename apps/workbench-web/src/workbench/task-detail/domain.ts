/**
 * Domain vocabulary for the 04.01 task-detail surface: step graph, AgentTrail
 * activities and conversation scopes. Linking is always by explicit IDs; no
 * cross-task or cross-step matching may be inferred from timestamps or actors.
 */

export type StepStatus = "pending" | "running" | "done" | "failed" | "blocked";

export interface StepNode {
  readonly id: string;
  readonly title: string;
  readonly agentName: string;
  readonly status: StepStatus;
}

export interface StepEdge {
  readonly from: string;
  readonly to: string;
}

export interface TaskGraph {
  readonly steps: readonly StepNode[];
  readonly edges: readonly StepEdge[];
}

export type ActivityKind = "step" | "review" | "dispatch" | "conversation";

export interface ActivityItem {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly title: string;
  readonly time: string;
  readonly actor: string;
  /** Explicit link to a step of this task; `null` means unlinked (show reason). */
  readonly stepId: string | null;
}

export type ConversationKind = "project-assistant" | "step-thread" | "observer";

export interface ConversationScope {
  readonly taskId: string;
  readonly kind: ConversationKind;
  readonly stepId: string | null;
}

export interface ConversationDescriptor {
  readonly scope: ConversationScope;
  readonly label: string;
}

export type TaskStatus = "running" | "awaiting-review" | "done" | "failed";

export interface AgentTrailStatus {
  readonly available: boolean;
  readonly reason?: string;
}

export interface TaskDetailSnapshot {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly workflowVersion: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly agentTrail: AgentTrailStatus;
  readonly graph: TaskGraph;
  readonly activities: readonly ActivityItem[];
  readonly conversations: readonly ConversationDescriptor[];
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  running: "进行中",
  "awaiting-review": "待评审",
  done: "已完成",
  failed: "失败",
};

const scopeKey = (taskId: string, kind: ConversationKind, stepId: string | null): string =>
  `${taskId}::${kind}::${stepId ?? "-"}`;

export function conversationScopeKey(scope: ConversationScope): string {
  return scopeKey(scope.taskId, scope.kind, scope.stepId);
}

export function sameConversationScope(a: ConversationScope, b: ConversationScope): boolean {
  return conversationScopeKey(a) === conversationScopeKey(b);
}

/**
 * Maps an activity to the step it belongs to, by explicit `stepId` only. An
 * activity without a link — or linked to a step that is not part of this
 * task's graph — is unlinked for this task, regardless of matching times or
 * actors.
 */
export function activityStep(activity: ActivityItem, stepIds: ReadonlySet<string>): string | null {
  return activity.stepId !== null && stepIds.has(activity.stepId) ? activity.stepId : null;
}

export function activitiesForStep(
  activities: readonly ActivityItem[],
  stepId: string,
): readonly ActivityItem[] {
  return activities.filter((activity) => activity.stepId === stepId);
}
