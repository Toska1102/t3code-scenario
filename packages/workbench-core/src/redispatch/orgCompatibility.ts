// 组织修订与工作流快照的兼容性判定（故事 14、31；裁决 D02）。
// 显示名变化且 ID 稳定为兼容；节点删除、绑定失效、必审未覆盖、收紧限制为不兼容，并定位步骤。
import type { OrgRevision, WorkflowVersionSnapshot } from "./types.ts";

export type OrgCompatibilityIssue =
  | { kind: "node-removed"; nodeId: string; stepId: string }
  | { kind: "binding-invalid"; nodeId: string; stepId?: string }
  | { kind: "mandatory-review-uncovered"; taskType: string; stepId?: string }
  | { kind: "limit-conflict"; nodeId: string; stepId: string; limit: "token" | "tool" | "model" };

export interface OrgCompatibilityResult {
  compatible: boolean;
  issues: OrgCompatibilityIssue[];
}

export function classifyOrgChange(
  previous: OrgRevision,
  current: OrgRevision,
  snapshot: WorkflowVersionSnapshot,
): OrgCompatibilityResult {
  const issues: OrgCompatibilityIssue[] = [];
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));

  for (const step of snapshot.steps) {
    if (!step.orgNodeId) {
      continue;
    }
    const before = previousNodes.get(step.orgNodeId);
    const now = currentNodes.get(step.orgNodeId);
    if (before && !now) {
      issues.push({ kind: "node-removed", nodeId: step.orgNodeId, stepId: step.id });
      continue;
    }
    if (!now) {
      continue;
    }
    if (!now.executor) {
      issues.push({ kind: "binding-invalid", nodeId: now.id, stepId: step.id });
    }
    if (
      now.tokenLimit !== undefined &&
      step.tokenLimit !== undefined &&
      now.tokenLimit < step.tokenLimit
    ) {
      issues.push({ kind: "limit-conflict", nodeId: now.id, stepId: step.id, limit: "token" });
    }
    const toolConflicts = (step.tools ?? []).filter(
      (tool) => now.allowedTools !== undefined && !now.allowedTools.includes(tool),
    );
    if (toolConflicts.length > 0) {
      issues.push({ kind: "limit-conflict", nodeId: now.id, stepId: step.id, limit: "tool" });
    }
    const modelConflicts = (step.models ?? []).filter(
      (model) => now.allowedModels !== undefined && !now.allowedModels.includes(model),
    );
    if (modelConflicts.length > 0) {
      issues.push({ kind: "limit-conflict", nodeId: now.id, stepId: step.id, limit: "model" });
    }
  }

  for (const rule of current.reviewRules) {
    if (!rule.mandatory) {
      continue;
    }
    const covered = snapshot.steps.some(
      (step) => step.mandatoryReview && step.taskType === rule.taskType,
    );
    // 无条件复核覆盖：快照确认时已通过的规则必然被步骤覆盖，确认前存在的规则则必须在此拦截。
    if (!covered) {
      issues.push({ kind: "mandatory-review-uncovered", taskType: rule.taskType });
    }
  }

  return { compatible: issues.length === 0, issues };
}
