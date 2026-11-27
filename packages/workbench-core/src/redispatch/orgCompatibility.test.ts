import { describe, expect, it } from "@effect/vitest";
import { classifyOrgChange, type OrgCompatibilityIssue } from "./orgCompatibility.ts";
import { hrOrg, resumeReviewV1, resumeReviewV1StepUsing } from "./testFixtures.ts";
import type { OrgRevision, WorkflowVersionSnapshot } from "./types.ts";

function revisionWith(nodes: OrgRevision["nodes"], revision = 2): OrgRevision {
  return { teamId: hrOrg.teamId, revision, nodes, reviewRules: hrOrg.reviewRules };
}

function snapshotWithSteps(steps: WorkflowVersionSnapshot["steps"]): WorkflowVersionSnapshot {
  return { ...resumeReviewV1, steps };
}

describe("classifyOrgChange", () => {
  it("仅改显示名且 ID 不变时兼容，允许继续派发", () => {
    const renamed = revisionWith(
      hrOrg.nodes.map((node) => (node.id === "node-ta" ? { ...node, name: "人才甄选" } : node)),
    );
    const result = classifyOrgChange(hrOrg, renamed, resumeReviewV1);
    expect(result).toEqual({ compatible: true, issues: [] });
  });

  it("删除步骤引用的节点时不兼容，并定位到步骤", () => {
    const current = revisionWith(hrOrg.nodes.filter((node) => node.id !== "node-ta"));
    const result = classifyOrgChange(hrOrg, current, resumeReviewV1);
    expect(result.compatible).toBe(false);
    expect(result.issues).toContainEqual({
      kind: "node-removed",
      nodeId: "node-ta",
      stepId: resumeReviewV1StepUsing("node-ta").id,
    } satisfies OrgCompatibilityIssue);
  });

  it("节点解除绑定后引用它的流程不可派发", () => {
    const unbound = revisionWith(
      hrOrg.nodes.map((node) => (node.id === "node-ta" ? { ...node, executor: null } : node)),
    );
    const result = classifyOrgChange(hrOrg, unbound, resumeReviewV1);
    expect(result.compatible).toBe(false);
    expect(result.issues.some((issue) => issue.kind === "binding-invalid")).toBe(true);
  });

  it("新增未覆盖的必审规则时不兼容", () => {
    const current: OrgRevision = {
      ...hrOrg,
      revision: 2,
      reviewRules: [
        ...hrOrg.reviewRules,
        { taskType: "简历审核", reviewerNodeId: "node-hr", mandatory: true },
      ],
    };
    const withoutReviewStep = snapshotWithSteps([
      { id: "step-1", name: "初审", orgNodeId: "node-ta", executorKind: "agent" },
    ]);
    const result = classifyOrgChange(hrOrg, current, withoutReviewStep);
    expect(result.compatible).toBe(false);
    expect(result.issues.some((issue) => issue.kind === "mandatory-review-uncovered")).toBe(true);
  });

  it("快照步骤已覆盖同任务类型必审规则时兼容", () => {
    const current: OrgRevision = {
      ...hrOrg,
      revision: 2,
      reviewRules: [
        ...hrOrg.reviewRules,
        { taskType: "简历审核", reviewerNodeId: "node-hr", mandatory: true },
      ],
    };
    const withReviewStep = snapshotWithSteps([
      {
        id: "step-review",
        name: "HR 复核",
        orgNodeId: "node-hr",
        executorKind: "human",
        mandatoryReview: true,
        taskType: "简历审核",
      },
    ]);
    expect(classifyOrgChange(hrOrg, current, withReviewStep).compatible).toBe(true);
  });

  it("收紧 Token 上限并与步骤配置冲突时不兼容", () => {
    const tightened = revisionWith(
      hrOrg.nodes.map((node) => (node.id === "node-ta" ? { ...node, tokenLimit: 100 } : node)),
    );
    const step = resumeReviewV1StepUsing("node-ta");
    const snapshot = snapshotWithSteps([{ ...step, tokenLimit: 8000 }]);
    const result = classifyOrgChange(hrOrg, tightened, snapshot);
    expect(result.compatible).toBe(false);
    expect(result.issues).toContainEqual({
      kind: "limit-conflict",
      nodeId: "node-ta",
      stepId: step.id,
      limit: "token",
    } satisfies OrgCompatibilityIssue);
  });

  it("允许模型被移除且步骤引用它时不兼容", () => {
    const narrowed = revisionWith(
      hrOrg.nodes.map((node) =>
        node.id === "node-ta" ? { ...node, allowedModels: ["Luna"] } : node,
      ),
    );
    const step = resumeReviewV1StepUsing("node-ta");
    const snapshot = snapshotWithSteps([{ ...step, models: ["GPT-5.4"] }]);
    const result = classifyOrgChange(hrOrg, narrowed, snapshot);
    expect(result.compatible).toBe(false);
    expect(result.issues).toContainEqual({
      kind: "limit-conflict",
      nodeId: "node-ta",
      stepId: step.id,
      limit: "model",
    } satisfies OrgCompatibilityIssue);
  });
});
