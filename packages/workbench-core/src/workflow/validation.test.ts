import { describe, expect, it } from "vite-plus/test";
import { confirmProblems } from "./validation.ts";
import type {
  TeamGraphSnapshot,
  WorkflowDraft,
  WorkflowStep,
} from "../../../workbench-contracts/src/workflow/types.ts";

function node(
  id: string,
  overrides: Partial<TeamGraphSnapshot["nodes"][number]> = {},
): TeamGraphSnapshot["nodes"][number] {
  return {
    id,
    name: id,
    parents: [],
    binding: { kind: "agent", instanceId: `${id}-agent`, agentName: "codex" },
    tools: "读取文件",
    tokens: 8000,
    model: "Claude Sonnet",
    reviewRules: [],
    ...overrides,
  };
}

const graph: TeamGraphSnapshot = {
  teamId: "team-1",
  teamName: "招聘运营",
  revision: 3,
  nodes: [
    node("hr", {
      name: "HR 总管",
      binding: { kind: "human", personName: "王总" },
      tokens: 4000,
      tools: "读取文件",
      reviewRules: [],
    }),
    node("od", { name: "OD", parents: ["hr"] }),
  ],
};

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: "s1",
    title: "明确岗位审核标准",
    ownerId: "od",
    mode: "execution",
    dependsOn: [],
    position: { x: 0, y: 0 },
    config: {
      prompt: "根据岗位要求拆解可核对审核标准。",
      inputRefs: [],
      outputKey: "标准",
      outputLabel: "岗位标准",
      tools: "读取文件",
      tokens: 6000,
      model: "Claude Sonnet",
    },
    ...overrides,
  };
}

function draft(
  overrides: Partial<WorkflowDraft> = {},
  steps: WorkflowStep[] = [step()],
): WorkflowDraft {
  return {
    id: "wf-1",
    revision: 1,
    name: "简历审核",
    description: "我想审核一批研发岗简历。",
    status: "draft",
    inputFields: [
      { key: "position", label: "岗位", kind: "shortText", required: true, description: "" },
    ],
    deliverable: "经复核的审核建议",
    memberIds: ["od"],
    steps,
    baseVersionNumber: null,
    lastConfirmedVersionNumber: null,
    lastConfirmedRevision: null,
    ...overrides,
  };
}

const graphWithRule: TeamGraphSnapshot = {
  ...graph,
  nodes: graph.nodes.map((candidate) =>
    candidate.id === "od"
      ? { ...candidate, reviewRules: [{ reviewerNodeId: "hr", taskTypeKeywords: ["简历审核"] }] }
      : candidate,
  ),
};

describe("confirm validation", () => {
  it("passes a complete workflow with no problems", () => {
    expect(confirmProblems(draft(), graph)).toEqual([]);
  });

  it("confirms without any runtime condition: offline agents, absent materials or a missing directory never block (D01)", () => {
    // None of these exist on the confirm path: no agent health, no dispatch
    // materials and no working directory are even accepted as inputs.
    const codes = confirmProblems(draft({}, [step({ ownerId: "od" })]), graph).map(
      (problem) => problem.code,
    );
    expect(codes).toEqual([]);
    expect(codes).not.toContain("agent.unavailable");
  });

  it("requires a name, a description, a deliverable and at least one input field", () => {
    const problems = confirmProblems(
      draft({ name: " ", description: "", deliverable: "", inputFields: [] }),
      graph,
    );
    expect(problems.map((problem) => problem.code)).toEqual([
      "workflow.name.required",
      "workflow.description.required",
      "workflow.deliverable.required",
      "workflow.inputFields.invalid",
    ]);
  });

  it("rejects duplicate or empty input field keys and labels", () => {
    const problems = confirmProblems(
      draft({
        inputFields: [
          { key: "a", label: "", kind: "shortText", required: true, description: "" },
          { key: "a", label: "岗位", kind: "file", required: false, description: "" },
          { key: "", label: "简历", kind: "file", required: false, description: "" },
        ],
      }),
      graph,
    );
    expect(problems.map((problem) => problem.code)).toEqual([
      "workflow.inputFields.invalid",
      "workflow.inputFields.duplicateKey",
      "workflow.inputFields.invalid",
    ]);
  });

  it("requires step titles, pool membership and a completed binding before confirm", () => {
    const unbound = {
      ...graph,
      nodes: graph.nodes.map((candidate) =>
        candidate.id === "od" ? { ...candidate, binding: null } : candidate,
      ),
    };
    const problems = confirmProblems(
      draft({}, [
        step({ title: " ", ownerId: "outsider" }),
        step({ id: "s2", title: "未绑定步骤", ownerId: "od" }),
      ]),
      unbound,
    );
    expect(problems.map((problem) => problem.code)).toEqual([
      "step.title.required",
      "step.owner.notInPool",
      "step.owner.unbound",
    ]);
  });

  it("requires a human binding for 人工必审 steps", () => {
    const problems = confirmProblems(draft({}, [step({ mode: "humanReview" })]), graph);
    expect(problems.map((problem) => problem.code)).toEqual(["step.review.needsHuman"]);
  });

  it("narrows tools, model and the positive token hard limit to the org node", () => {
    const problems = confirmProblems(
      draft({}, [
        step({ config: { ...step().config, tools: "读写文件", model: "GPT-5.4", tokens: 0 } }),
      ]),
      graph,
    );
    expect(problems.map((problem) => problem.code)).toEqual([
      "step.tokens.invalid",
      "step.tools.exceedsOrg",
      "step.model.exceedsOrg",
    ]);
  });

  it("rejects tokens above the org node even for an otherwise valid step", () => {
    const problems = confirmProblems(
      draft({}, [step({ config: { ...step().config, tokens: 8001 } })]),
      graph,
    );
    expect(problems.map((problem) => problem.code)).toEqual(["step.tokens.invalid"]);
  });

  it("requires step inputs to resolve to a dispatch field or an upstream step output", () => {
    const first = step({ id: "a", config: { ...step().config, inputRefs: [], outputKey: "标准" } });
    const second = step({
      id: "b",
      dependsOn: ["a"],
      config: {
        ...step().config,
        inputRefs: [
          { kind: "dispatch", fieldKey: "missing" },
          { kind: "step", stepId: "ghost" },
        ],
      },
    });
    const forward = step({
      id: "c",
      config: { ...step().config, inputRefs: [{ kind: "step", stepId: "d" }] },
    });
    const later = step({ id: "d", dependsOn: ["c"] });
    const problems = confirmProblems(draft({}, [second, first, forward, later]), graph);
    expect(problems.map((problem) => problem.code)).toEqual([
      "step.input.unresolved",
      "step.input.unresolved",
      "step.input.unresolved",
    ]);
  });

  it("requires an output key on every step", () => {
    const problems = confirmProblems(
      draft({}, [step({ config: { ...step().config, outputKey: " " } })]),
      graph,
    );
    expect(problems.map((problem) => problem.code)).toEqual(["step.output.required"]);
  });

  it("reports graph problems alongside step problems", () => {
    const problems = confirmProblems(
      draft({}, [step({ id: "a", dependsOn: ["b"] }), step({ id: "b", dependsOn: ["a"] })]),
      graph,
    );
    expect(problems.map((problem) => problem.code)).toContain("graph.cycle");
  });

  it("enforces a matching review policy: the reviewer must hold a humanReview step downstream of every reviewed step", () => {
    // Missing review step entirely.
    expect(confirmProblems(draft(), graphWithRule).map((problem) => problem.code)).toEqual([
      "policy.review.unmet",
    ]);
    // Review step present but not downstream of the OD step.
    const misplaced = draft({}, [
      step({ id: "od-step", ownerId: "od" }),
      step({
        id: "hr-step",
        ownerId: "hr",
        mode: "humanReview",
        config: { ...step().config, inputRefs: [], tokens: 3000 },
      }),
    ]);
    expect(confirmProblems(misplaced, graphWithRule).map((problem) => problem.code)).toEqual([
      "policy.review.unmet",
    ]);
    // Review step downstream of every reviewed step satisfies the policy.
    const ok = draft({}, [
      step({ id: "od-step", ownerId: "od", config: { ...step().config, inputRefs: [] } }),
      step({
        id: "hr-step",
        ownerId: "hr",
        mode: "humanReview",
        dependsOn: ["od-step"],
        config: {
          ...step().config,
          inputRefs: [{ kind: "step", stepId: "od-step" }],
          tokens: 3000,
        },
      }),
    ]);
    expect(confirmProblems(ok, graphWithRule)).toEqual([]);
  });

  it("ignores review rules whose task-type keywords do not match the workflow name", () => {
    const other = draft({ name: "薪酬核算" });
    expect(confirmProblems(other, graph)).toEqual([]);
  });
});
