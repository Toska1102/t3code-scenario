import { describe, expect, it } from "vite-plus/test";
import { createAssistantGenerator } from "./assistantGenerator.ts";
import { coveragePreview } from "./members.ts";
import type {
  TeamGraphSnapshot,
  WorkflowDraft,
} from "../../../workbench-contracts/src/workflow/types.ts";

const graph: TeamGraphSnapshot = {
  teamId: "team-1",
  teamName: "招聘运营",
  revision: 1,
  nodes: [
    {
      id: "hr",
      name: "HR 总管",
      parents: [],
      binding: { kind: "human", personName: "王总" },
      tools: "读取文件",
      tokens: 4000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "od",
      name: "OD",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "od-agent", agentName: "claude" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [{ reviewerNodeId: "hr", taskTypeKeywords: ["简历"] }],
    },
    {
      id: "cb",
      name: "C&B",
      parents: ["hr"],
      binding: null,
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
  ],
};

function draft(partial: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    id: "wf-1",
    revision: 1,
    name: "简历审核",
    description: "审核研发岗简历并复核",
    status: "draft",
    inputFields: [
      { key: "position", label: "岗位", kind: "shortText", required: true, description: "" },
    ],
    deliverable: "审核建议",
    memberIds: ["od"],
    steps: [],
    baseVersionNumber: null,
    lastConfirmedVersionNumber: null,
    lastConfirmedRevision: null,
    ...partial,
  };
}

describe("assistant generator", () => {
  it("creates one chained execution step per selected member plus the required human review", async () => {
    const generator = createAssistantGenerator();
    const raw = await generator.generate({
      draft: draft(),
      teamGraph: graph,
      coverage: coveragePreview(graph, ["od"], "简历审核"),
    });
    if (!Array.isArray(raw)) throw new Error("expected an array of steps");
    expect(raw.map((step) => step.title)).toEqual(["OD 初审", "HR 总管 复审"]);
    expect(raw[0]?.ownerId).toBe("od");
    expect(raw[0]?.mode).toBe("execution");
    expect(raw[1]?.ownerId).toBe("hr");
    expect(raw[1]?.mode).toBe("humanReview");
    expect(raw[1]?.dependsOn).toEqual([raw[0]?.id]);
    expect(raw[0]?.config.inputRefs).toContainEqual({ kind: "dispatch", fieldKey: "position" });
  });

  it("unbound members still get a step; confirmation will block until they are bound", async () => {
    const generator = createAssistantGenerator();
    const raw = await generator.generate({
      draft: draft({ memberIds: ["od", "cb"] }),
      teamGraph: graph,
      coverage: coveragePreview(graph, ["od", "cb"], "简历审核"),
    });
    if (!Array.isArray(raw)) throw new Error("expected an array of steps");
    expect(raw.map((step) => step.ownerId)).toEqual(["od", "cb", "hr"]);
  });

  it("without members it produces nothing; the coverage preview is what explains the gap", async () => {
    const generator = createAssistantGenerator();
    const raw = await generator.generate({
      draft: draft({ memberIds: [] }),
      teamGraph: graph,
      coverage: coveragePreview(graph, [], "简历审核"),
    });
    expect(raw).toEqual([]);
  });
});
