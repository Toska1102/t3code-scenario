import { describe, expect, it } from "vite-plus/test";
import { parseGeneratedSteps, type WorkflowGenerator } from "./generator.ts";
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
      binding: { kind: "agent", instanceId: "od-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
  ],
};

const draft: WorkflowDraft = {
  id: "wf-1",
  revision: 1,
  name: "简历审核",
  description: "审核简历",
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
};

const validOutput = [
  {
    id: "s1",
    title: "明确岗位审核标准",
    ownerId: "od",
    mode: "execution",
    dependsOn: [],
    config: {
      prompt: "拆解标准",
      inputRefs: [{ kind: "dispatch", fieldKey: "position" }],
      outputKey: "标准",
      outputLabel: "岗位标准",
      tools: "读取文件",
      tokens: 6000,
      model: "Claude Sonnet",
    },
  },
];

describe("structured model-output adapter", () => {
  it("accepts structured JSON steps into typed WorkflowStep values", () => {
    const result = parseGeneratedSteps(validOutput, draft, graph);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.title).toBe("明确岗位审核标准");
  });

  it("rejects output that is not a JSON array of objects without throwing", async () => {
    for (const raw of [null, "steps", {}, [42], [[]]]) {
      const result = parseGeneratedSteps(raw, draft, graph);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problems[0]?.code).toBe("generator.output.invalid");
    }
  });

  it("reports hallucinated owner, dependency and input references as problems instead of accepting them", () => {
    const result = parseGeneratedSteps(
      [{ ...validOutput[0]!, id: "s1", dependsOn: ["ghost"], ownerId: "stranger" }],
      draft,
      graph,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.problems.map((problem) => problem.message).join("\n");
      expect(messages).toContain("未知步骤");
      expect(messages).toContain("不在团队组织中");
    }
    const badRef = parseGeneratedSteps(
      [
        {
          ...validOutput[0]!,
          config: {
            ...validOutput[0]!.config,
            inputRefs: [{ kind: "dispatch", fieldKey: "ghost" }],
          },
        },
      ],
      draft,
      graph,
    );
    expect(badRef.ok).toBe(false);
    if (!badRef.ok)
      expect(badRef.problems.map((problem) => problem.code)).toContain("generator.output.invalid");
  });

  it("is satisfied by the WorkflowGenerator port shape (async, raw unknown output)", async () => {
    const generator: WorkflowGenerator = {
      generate: async () => validOutput,
    };
    const raw = await generator.generate({
      draft,
      teamGraph: graph,
      coverage: { candidateIds: ["od", "hr"], autoIncludedIds: ["hr"], appliedReviewRules: [] },
    });
    expect(parseGeneratedSteps(raw, draft, graph).ok).toBe(true);
  });
});
