import { describe, expect, it } from "vite-plus/test";
import {
  DISPATCH_INPUT_FIELD_KIND_LABEL,
  WORKFLOW_STEP_MODE_LABEL,
  edgeId,
  workflowVersionLabel,
  type DispatchInputField,
  type WorkflowDraft,
  type WorkflowProblem,
  type WorkflowStep,
} from "./types.ts";

describe("workflow contracts", () => {
  it("labels step modes and dispatch input kinds in the design's wording", () => {
    expect(WORKFLOW_STEP_MODE_LABEL.execution).toBe("执行");
    expect(WORKFLOW_STEP_MODE_LABEL.humanReview).toBe("人工必审");
    expect(DISPATCH_INPUT_FIELD_KIND_LABEL.file).toBe("文件");
  });

  it("formats the confirmed version subtitle shown on 03.01", () => {
    expect(workflowVersionLabel({ name: "简历审核", versionNumber: 1 })).toBe(
      "简历审核 · 已确认 v1",
    );
  });

  it("identifies an edge by its endpoints so duplicate edges and problems share one id", () => {
    expect(edgeId("s1", "s2")).toBe("s1->s2");
  });

  it("carries a targeted problem contract the UI and server can both rely on", () => {
    const step: WorkflowStep = {
      id: "s1",
      title: "",
      ownerId: "od",
      mode: "execution",
      dependsOn: [],
      position: { x: 0, y: 0 },
      config: {
        prompt: "",
        inputRefs: [],
        outputKey: "",
        outputLabel: "",
        tools: "读取文件",
        tokens: 6000,
        model: "Claude Sonnet",
      },
    };
    const field: DispatchInputField = {
      key: "position",
      label: "岗位",
      kind: "shortText",
      required: true,
      description: "待招聘的岗位名称",
    };
    const draft: WorkflowDraft = {
      id: "wf-1",
      revision: 3,
      name: "简历审核",
      description: "我想审核一批研发岗简历。",
      status: "draft",
      inputFields: [field],
      deliverable: "经复核的审核建议",
      memberIds: ["od", "recruit"],
      steps: [step],
      baseVersionNumber: null,
      lastConfirmedVersionNumber: null,
      lastConfirmedRevision: null,
    };
    const problem: WorkflowProblem = {
      code: "step.title.required",
      target: { kind: "step", id: step.id },
      message: "请填写步骤名称。",
    };
    expect(draft.revision).toBe(3);
    expect(problem.target.id).toBe("s1");
  });
});
