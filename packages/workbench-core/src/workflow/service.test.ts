import { describe, expect, it } from "vite-plus/test";
import { parseGeneratedSteps } from "./generator.ts";
import { createWorkflowService, type WorkflowServicePorts } from "./service.ts";
import { createMemoryWorkflowStore } from "./store.ts";
import type {
  TeamGraphSnapshot,
  WorkflowDraft,
} from "../../../workbench-contracts/src/workflow/types.ts";

const graph: TeamGraphSnapshot = {
  teamId: "team-1",
  teamName: "招聘运营",
  revision: 3,
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
    {
      id: "recruit",
      name: "招聘",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "recruit-agent", agentName: "claude" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
  ],
};

function validDraft(id: string): WorkflowDraft {
  return {
    id,
    revision: 1,
    name: "简历审核",
    description: "我想审核一批研发岗简历。",
    status: "draft",
    inputFields: [
      {
        key: "position",
        label: "岗位",
        kind: "shortText",
        required: true,
        description: "待招聘岗位",
      },
    ],
    deliverable: "经复核的审核建议",
    memberIds: ["od", "recruit"],
    steps: [
      {
        id: "s1",
        title: "明确岗位审核标准",
        ownerId: "od",
        mode: "execution",
        dependsOn: [],
        position: { x: 0, y: 140 },
        config: {
          prompt: "拆解",
          inputRefs: [{ kind: "dispatch", fieldKey: "position" }],
          outputKey: "标准",
          outputLabel: "岗位标准",
          tools: "读取文件",
          tokens: 6000,
          model: "Claude Sonnet",
        },
      },
      {
        id: "s2",
        title: "复核审核建议",
        ownerId: "hr",
        mode: "humanReview",
        dependsOn: ["s1"],
        position: { x: 280, y: 140 },
        config: {
          prompt: "复核",
          inputRefs: [{ kind: "step", stepId: "s1" }],
          outputKey: "建议",
          outputLabel: "复核建议",
          tools: "读取文件",
          tokens: 3000,
          model: "Claude Sonnet",
        },
      },
    ],
    baseVersionNumber: null,
    lastConfirmedVersionNumber: null,
    lastConfirmedRevision: null,
  };
}

function ports(overrides: Partial<WorkflowServicePorts> = {}): WorkflowServicePorts {
  return {
    store: createMemoryWorkflowStore(),
    currentTeamGraph: async () => graph,
    newId: (prefix) => `${prefix}-fixed`,
    now: () => "2026-11-27T10:00:00.000Z",
    actor: () => "admin-1",
    ...overrides,
  };
}

describe("workflow service", () => {
  it("confirms a structurally complete draft into an immutable version without any runtime condition (D01, story 26)", async () => {
    const service = createWorkflowService(ports());
    await service.saveDraft(validDraft("wf-1"));
    const result = await service.confirmDraft("wf-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versionNumber).toBe(1);
    expect(result.value.confirmedAt).toBe("2026-11-27T10:00:00.000Z");
    expect(result.value.confirmedBy).toBe("admin-1");
    expect(result.value.steps.map((step) => step.id)).toEqual(["s1", "s2"]);
  });

  it("rejects confirm with targeted problems and leaves the draft editable (failure keeps the draft)", async () => {
    const service = createWorkflowService(ports());
    await service.saveDraft({ ...validDraft("wf-1"), name: " " });
    const result = await service.confirmDraft("wf-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toContain("workflow.name.required");
    const stored = await service.loadDraft("wf-1");
    // The failed confirm must not have persisted a new revision or version.
    expect(stored?.name).toBe(" ");
    expect(stored?.revision).toBe(2);
    expect(await service.listHistory("wf-1")).toHaveLength(0);
  });

  it("validates against the current organization revision at confirm time", async () => {
    let revision = 3;
    const service = createWorkflowService(
      ports({ currentTeamGraph: async () => ({ ...graph, revision }) }),
    );
    await service.saveDraft(validDraft("wf-1"));
    revision = 4;
    const result = await service.confirmDraft("wf-1");
    expect(result.ok).toBe(true);
  });

  it("retries an idempotent confirm at the same draft revision instead of minting a second version", async () => {
    const service = createWorkflowService(ports());
    await service.saveDraft(validDraft("wf-1"));
    const first = await service.confirmDraft("wf-1");
    const retry = await service.confirmDraft("wf-1");
    expect(first.ok && retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.value.versionNumber).toBe(first.value.versionNumber);
    }
    const versions = await service.listHistory("wf-1");
    expect(versions).toHaveLength(1);
  });

  it("advances to v2 when a confirmed draft is edited and confirmed again (story 27)", async () => {
    const service = createWorkflowService(ports());
    await service.saveDraft(validDraft("wf-1"));
    await service.confirmDraft("wf-1");
    const stored = await service.loadDraft("wf-1");
    await service.saveDraft({ ...stored!, name: "简历审核改", revision: stored!.revision + 1 });
    const second = await service.confirmDraft("wf-1");
    expect(second.ok && second.value.versionNumber === 2).toBe(true);
    const versions = await service.listHistory("wf-1");
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
  });

  it("never mutates a published version; revisions start from the version snapshot (R02)", async () => {
    const service = createWorkflowService(ports());
    await service.saveDraft(validDraft("wf-1"));
    const first = await service.confirmDraft("wf-1");
    const revision = await service.startRevision("wf-1", 1);
    expect(revision.baseVersionNumber).toBe(1);
    expect(revision.status).toBe("draft");
    revision.name = "改动的草稿";
    await service.saveDraft(revision);
    const versions = await service.listHistory("wf-1");
    expect(versions[0]!.name).toBe("简历审核");
    expect(first.ok && versions[0]!.versionNumber === 1).toBe(true);
  });

  it("rejects concurrent saves on a stale revision (optimistic concurrency)", async () => {
    const service = createWorkflowService(ports());
    const saved = await service.saveDraft(validDraft("wf-1"));
    expect(saved.ok).toBe(true);
    const stale = { ...validDraft("wf-1"), revision: 0 };
    const result = await service.saveDraft(stale);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.code).toBe("draft.revision.conflict");
  });

  it("generates steps through the injected generator, validating output and keeping the previous draft on failure", async () => {
    let calls = 0;
    const service = createWorkflowService(
      ports({
        generator: {
          generate: async () => {
            calls += 1;
            if (calls === 1) return "not json";
            return [
              {
                id: "g1",
                title: "初审简历",
                ownerId: "recruit",
                mode: "execution",
                dependsOn: [],
                config: {
                  prompt: "初审",
                  inputRefs: [{ kind: "dispatch", fieldKey: "position" }],
                  outputKey: "初审结果",
                  tools: "读取文件",
                  tokens: 6000,
                  model: "Claude Sonnet",
                },
              },
            ];
          },
        },
      }),
    );
    await service.saveDraft(validDraft("wf-1"));
    const failed = await service.generateSteps("wf-1");
    expect(failed.ok).toBe(false);
    const before = await service.loadDraft("wf-1");
    expect(before?.steps.map((step) => step.id)).toEqual(["s1", "s2"]);
    const ok = await service.generateSteps("wf-1");
    expect(ok).toEqual({ ok: true, value: ["g1"] });
    const after = await service.loadDraft("wf-1");
    expect(after?.steps.map((step) => step.id)).toEqual(["g1"]);
  });

  it("parses generator output through the structured adapter, never executing it", () => {
    expect(parseGeneratedSteps("rm -rf /", validDraft("wf-1"), graph).ok).toBe(false);
  });
});
