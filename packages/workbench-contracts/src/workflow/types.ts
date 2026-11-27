/**
 * Workflow domain contracts shared by the workbench web app, the application
 * layer (workbench-core) and, after integration, the server transport.
 * Plain types and pure helpers only: no runtime dependency beyond this module.
 */

export type WorkflowStepMode = "execution" | "humanReview";

export const WORKFLOW_STEP_MODE_LABEL: Record<WorkflowStepMode, string> = {
  execution: "执行",
  humanReview: "人工必审",
};

export type DispatchInputFieldKind = "shortText" | "longText" | "file";

export const DISPATCH_INPUT_FIELD_KIND_LABEL: Record<DispatchInputFieldKind, string> = {
  shortText: "短文本",
  longText: "长文本",
  file: "文件",
};

/** One 派发输入 field: label, stable key, requiredness and explanation (story 21). */
export interface DispatchInputField {
  key: string;
  label: string;
  kind: DispatchInputFieldKind;
  required: boolean;
  description: string;
}

/** Where a step reads its input from: a dispatch field or an upstream step output. */
export type StepInputRef =
  | { kind: "dispatch"; fieldKey: string }
  | { kind: "step"; stepId: string };

export interface WorkflowStepConfig {
  prompt: string;
  inputRefs: StepInputRef[];
  outputKey: string;
  outputLabel: string;
  tools: string;
  tokens: number;
  model: string;
}

export interface WorkflowStep {
  id: string;
  title: string;
  ownerId: string;
  mode: WorkflowStepMode;
  dependsOn: string[];
  position: { x: number; y: number };
  config: WorkflowStepConfig;
}

export type WorkflowStatus = "draft" | "confirmed";

/**
 * The editable workflow. A draft that was confirmed keeps `status: "draft"`
 * for its next revision; published data lives in WorkflowVersionRecord.
 * `revision` provides optimistic concurrency between saves.
 */
export interface WorkflowDraft {
  id: string;
  revision: number;
  name: string;
  description: string;
  status: WorkflowStatus;
  inputFields: DispatchInputField[];
  deliverable: string;
  /** Org nodes the admin picked manually; ancestors are added automatically. */
  memberIds: string[];
  steps: WorkflowStep[];
  /** 本次材料 registered at creation (story 17); the first dispatch may reuse them. */
  materials?: import("../project/types.ts").WorkflowMaterial[];
  /** Confirmed version this revision draft started from, if any (story 27). */
  baseVersionNumber: number | null;
  /** Version produced by the last successful confirm, for idempotent retry (D08 seam). */
  lastConfirmedVersionNumber: number | null;
  /** Draft revision that produced it; a confirm retry at this revision returns the same version. */
  lastConfirmedRevision: number | null;
}

/** Immutable snapshot created by 只确认工作流 (story 26/27). Dispatch pins one of these. */
export interface WorkflowVersionRecord {
  workflowId: string;
  versionNumber: number;
  name: string;
  description: string;
  inputFields: DispatchInputField[];
  deliverable: string;
  steps: WorkflowStep[];
  confirmedAt: string;
  confirmedBy: string;
}

/** Read-only view of the team organization the workflow validates against. */
export type NodeBinding =
  | { kind: "human"; personName: string }
  | { kind: "agent"; instanceId: string; agentName: string }
  | null;

export interface TeamGraphReviewRule {
  reviewerNodeId: string;
  /** The rule applies to workflows whose name contains one of these keywords. */
  taskTypeKeywords: string[];
}

/** Multi-parent org node (story 10: one or more parents in the adjacent layer). */
export interface TeamGraphNode {
  id: string;
  name: string;
  /** Empty for the root. */
  parents: string[];
  binding: NodeBinding;
  tools: string;
  tokens: number;
  model: string;
  reviewRules: TeamGraphReviewRule[];
}

export interface TeamGraphSnapshot {
  teamId: string;
  teamName: string;
  /** Organization revision the snapshot was read at (D02 seam). */
  revision: number;
  nodes: TeamGraphNode[];
}

export type WorkflowProblemTargetKind =
  | "workflow"
  | "step"
  | "edge"
  | "inputField"
  | "member"
  | "policy";

export interface WorkflowProblemTarget {
  kind: WorkflowProblemTargetKind;
  /** Step id, field key, edge `from->to`, member node id or policy id. */
  id?: string;
}

export interface WorkflowProblem {
  code: WorkflowProblemCode;
  target: WorkflowProblemTarget;
  message: string;
}

export type WorkflowProblemCode =
  | "workflow.name.required"
  | "workflow.description.required"
  | "workflow.deliverable.required"
  | "workflow.inputFields.invalid"
  | "workflow.inputFields.duplicateKey"
  | "workflow.steps.empty"
  | "step.title.required"
  | "step.owner.notInPool"
  | "step.owner.unbound"
  | "step.review.needsHuman"
  | "step.tokens.invalid"
  | "step.tools.exceedsOrg"
  | "step.model.exceedsOrg"
  | "step.input.unresolved"
  | "step.output.required"
  | "graph.cycle"
  | "graph.danglingDependency"
  | "graph.duplicateEdge"
  | "graph.selfEdge"
  | "generator.output.invalid"
  | "draft.revision.conflict"
  | "draft.notFound"
  | "policy.review.unmet";

export type WorkflowResult<T> = { ok: true; value: T } | { ok: false; problems: WorkflowProblem[] };

/** Stable id for a dependency edge, used by problems, the canvas and tests. */
export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

export function workflowVersionLabel(
  record: Pick<WorkflowVersionRecord, "name" | "versionNumber">,
): string {
  return `${record.name} · 已确认 v${record.versionNumber}`;
}
