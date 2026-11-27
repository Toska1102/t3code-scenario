import {
  edgeId,
  type TeamGraphSnapshot,
  type WorkflowDraft,
  type WorkflowProblem,
  type WorkflowStep,
} from "../../../workbench-contracts/src/workflow/types.ts";
import { findGraphProblems } from "./graph.ts";
import { applicableReviewRules, candidatePool } from "./members.ts";

const TOOL_NARROWING_ORDER = new Set(["无工具", "读取文件", "读写文件"]);

function toolsWithin(orgTools: string, stepTools: string): boolean {
  if (stepTools === "无工具") return true;
  if (stepTools === orgTools) return true;
  return orgTools === "读写文件" && stepTools === "读取文件";
}

function transitiveAncestors(steps: WorkflowStep[], stepId: string): Set<string> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const walk = (id: string): void => {
    const step = byId.get(id);
    for (const dependency of step?.dependsOn ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      walk(dependency);
    }
  };
  walk(stepId);
  return seen;
}

/**
 * Confirmation gates (story 26): organization, workflow structure, inputs and
 * outputs, members and review rules. Deliberately no agent health, dispatch
 * materials or working directory here — those are dispatch concerns (D01).
 */
export function confirmProblems(draft: WorkflowDraft, graph: TeamGraphSnapshot): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  if (!draft.name.trim()) {
    problems.push({
      code: "workflow.name.required",
      target: { kind: "workflow" },
      message: "请填写流程名称。",
    });
  }
  if (!draft.description.trim()) {
    problems.push({
      code: "workflow.description.required",
      target: { kind: "workflow" },
      message: "请填写这件事通常怎么做。",
    });
  }
  if (!draft.deliverable.trim()) {
    problems.push({
      code: "workflow.deliverable.required",
      target: { kind: "workflow" },
      message: "请填写交付物。",
    });
  }
  if (!draft.inputFields.length) {
    problems.push({
      code: "workflow.inputFields.invalid",
      target: { kind: "workflow" },
      message: "请至少定义一个派发输入字段。",
    });
  }
  const seenKeys = new Set<string>();
  for (const field of draft.inputFields) {
    if (!field.key.trim() || !field.label.trim()) {
      problems.push({
        code: "workflow.inputFields.invalid",
        target: field.key ? { kind: "inputField", id: field.key } : { kind: "inputField" },
        message: "输入字段的稳定标识和标签都必须填写。",
      });
    }
    if (seenKeys.has(field.key)) {
      problems.push({
        code: "workflow.inputFields.duplicateKey",
        target: { kind: "inputField", id: field.key },
        message: `输入字段标识「${field.key}」重复。`,
      });
    }
    seenKeys.add(field.key);
  }
  if (!draft.steps.length) {
    problems.push({
      code: "workflow.steps.empty",
      target: { kind: "workflow" },
      message: "请添加执行步骤。",
    });
  }

  problems.push(...findGraphProblems(draft.steps));

  const pool = candidatePool(graph, draft.memberIds);
  const poolById = new Map(pool.map((entry) => [entry.node.id, entry.node]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const stepById = new Map(draft.steps.map((step) => [step.id, step]));

  for (const step of draft.steps) {
    if (!step.title.trim()) {
      problems.push({
        code: "step.title.required",
        target: { kind: "step", id: step.id },
        message: "请填写步骤名称。",
      });
    }
    if (!poolById.has(step.ownerId)) {
      problems.push({
        code: "step.owner.notInPool",
        target: { kind: "step", id: step.id },
        message: `「${step.title || step.id}」的负责人不在参与成员范围内。`,
      });
      continue;
    }
    const owner = poolById.get(step.ownerId)!;
    if (!owner.binding) {
      problems.push({
        code: "step.owner.unbound",
        target: { kind: "step", id: step.id },
        message: `「${step.title}」的负责人尚未绑定人员或 Agent，确认前需补齐。`,
      });
    }
    if (step.mode === "humanReview" && owner.binding?.kind !== "human") {
      problems.push({
        code: "step.review.needsHuman",
        target: { kind: "step", id: step.id },
        message: `「${step.title}」是人工必审步骤，负责人必须绑定人员。`,
      });
    }
    if (
      !Number.isInteger(step.config.tokens) ||
      step.config.tokens <= 0 ||
      step.config.tokens > owner.tokens
    ) {
      problems.push({
        code: "step.tokens.invalid",
        target: { kind: "step", id: step.id },
        message: `「${step.title}」的 Token 上限必须是正整数且不超过组织节点的 ${owner.tokens}。`,
      });
    }
    if (step.mode === "execution" && owner.binding?.kind === "agent") {
      if (
        !TOOL_NARROWING_ORDER.has(step.config.tools) ||
        !toolsWithin(owner.tools, step.config.tools)
      ) {
        problems.push({
          code: "step.tools.exceedsOrg",
          target: { kind: "step", id: step.id },
          message: `「${step.title}」的工具超出组织节点允许范围（${owner.tools}）。`,
        });
      }
      if (step.config.model !== owner.model) {
        problems.push({
          code: "step.model.exceedsOrg",
          target: { kind: "step", id: step.id },
          message: `「${step.title}」的模型超出组织节点允许的 ${owner.model}。`,
        });
      }
    }
    if (!step.config.outputKey.trim()) {
      problems.push({
        code: "step.output.required",
        target: { kind: "step", id: step.id },
        message: `「${step.title}」需要定义输出。`,
      });
    }
    for (const ref of step.config.inputRefs) {
      const resolved =
        ref.kind === "dispatch"
          ? draft.inputFields.some((field) => field.key === ref.fieldKey)
          : stepById.has(ref.stepId) && transitiveAncestors(draft.steps, step.id).has(ref.stepId);
      if (!resolved) {
        problems.push({
          code: "step.input.unresolved",
          target: { kind: "step", id: step.id },
          message: `「${step.title}」存在无法解析的输入来源，须补齐。`,
        });
      }
    }
  }

  // Review policies come from the team graph (story 12); the workflow can only
  // satisfy them, never loosen them.
  for (const rule of applicableReviewRules(graph, draft.name)) {
    const reviewer = nodeById.get(rule.reviewerNodeId);
    const reviewedSteps = draft.steps.filter(
      (step) => step.ownerId === rule.ownerNodeId && step.mode === "execution",
    );
    const satisfied =
      reviewer !== undefined &&
      reviewedSteps.length > 0 &&
      draft.steps.some(
        (step) =>
          step.ownerId === rule.reviewerNodeId &&
          step.mode === "humanReview" &&
          reviewedSteps.every((reviewed) =>
            transitiveAncestors(draft.steps, step.id).has(reviewed.id),
          ),
      );
    if (!satisfied) {
      problems.push({
        code: "policy.review.unmet",
        target: { kind: "policy", id: edgeId(rule.ownerNodeId, rule.reviewerNodeId) },
        message: `「${reviewer?.name ?? rule.reviewerNodeId}」的评审规则要求对这些步骤进行人工必审。`,
      });
    }
  }

  return problems;
}
