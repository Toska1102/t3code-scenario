import { describe, expect, it } from "vite-plus/test";
import { createProjectService } from "./service.ts";
import { createMemoryProjectStore } from "./store.ts";
import { createMemoryWorkflowStore } from "../workflow/store.ts";
import { createWorkflowService, type WorkflowServicePorts } from "../workflow/service.ts";
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

function confirmableDraft(id: string): WorkflowDraft {
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
    memberIds: ["od"],
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

function setup() {
  const projectStore = createMemoryProjectStore();
  const workflowStore = createMemoryWorkflowStore();
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;
  const workflow = createWorkflowService({
    store: workflowStore,
    currentTeamGraph: async () => graph,
    newId: id,
    now: () => "2026-11-27T00:00:00.000Z",
    actor: () => "admin",
  } satisfies WorkflowServicePorts);
  let dispatchCounts: Record<string, number> = {};
  const projects = createProjectService({
    store: projectStore,
    workflowStore,
    workflow: {
      loadDraft: (workflowId) => workflow.loadDraft(workflowId),
      listHistory: (workflowId) => workflow.listHistory(workflowId),
      createDraft: (input) => workflow.createDraft(input),
    },
    countDispatches: async (workflowId) => dispatchCounts[workflowId] ?? 0,
    newId: id,
    now: () => "2026-11-27T00:00:00.000Z",
  });
  return {
    projects,
    workflow,
    workflowStore,
    setDispatchCounts: (record: Record<string, number>) => (dispatchCounts = record),
  };
}

describe("project service", () => {
  it("creates a project from a name only, trimming whitespace (story 4)", async () => {
    const { projects } = setup();
    const created = await projects.createProject({
      name: "  校招项目  ",
      teamId: "team-1",
      teamName: "招聘运营",
    });
    if (!created.ok) throw new Error("setup");
    expect(created.value.name).toBe("校招项目");
    expect(created.value.teamId).toBe("team-1");
    void created;
  });

  it("rejects blank names and records nothing", async () => {
    const { projects } = setup();
    const result = await projects.createProject({ name: "   " });
    expect(result.ok).toBe(false);
    expect(await projects.listProjects()).toHaveLength(0);
  });

  it("creates a workflow draft under a project; a repeated submit with the same idempotency key recovers the same draft (story 17)", async () => {
    const { projects } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const first = await projects.createWorkflowDraft(
      project.id,
      { name: "简历审核", description: "审核简历" },
      { key: "submit-1" },
    );
    if (!first.ok) throw new Error("setup");
    const again = await projects.createWorkflowDraft(
      project.id,
      { name: "简历审核", description: "后来改过的描述" },
      { key: "submit-1" },
    );
    if (!again.ok) throw new Error("setup");
    expect(again.value.id).toBe(first.value.id);
    expect(again.value.description).toBe(first.value.description);
    const list = await projects.workflowCatalog(project.id);
    expect(list).toHaveLength(1);
  });

  it("serializes concurrent submits with the same key into a single draft (idempotency race)", async () => {
    const { projects } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const [a, b] = await Promise.all([
      projects.createWorkflowDraft(
        project.id,
        { name: "简历审核", description: "审核简历" },
        { key: "race-1" },
      ),
      projects.createWorkflowDraft(
        project.id,
        { name: "简历审核", description: "审核简历" },
        { key: "race-1" },
      ),
    ]);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(b.value.id).toBe(a.value.id);
    expect(await projects.workflowCatalog(project.id)).toHaveLength(1);
  });

  it("registers 本次材料 on the created draft (story 17)", async () => {
    const { projects } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const created = await projects.createWorkflowDraft(project.id, {
      name: "简历审核",
      description: "审核简历",
      materials: [
        { id: "m1", fileName: "张三-研发岗简历.pdf" },
        { id: "m2", fileName: "岗位要求.pdf" },
      ],
    });
    if (!created.ok) throw new Error(JSON.stringify(created.problems));
    expect(created.value.materials).toHaveLength(2);
  });

  it("rejects invalid attachments, marks each bad file and creates nothing (story 17: failure marks the file)", async () => {
    const { projects } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const result = await projects.createWorkflowDraft(project.id, {
      name: "简历审核",
      description: "审核简历",
      materials: [
        { id: "m1", fileName: "好简历.pdf" },
        { id: "m2", fileName: "" },
        { id: "m3", fileName: "a/b.pdf" },
        { id: "m4", fileName: "好简历.pdf" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const badIds = result.problems.map((problem) => problem.target?.id).sort();
    expect(badIds).toEqual(["m2", "m3", "m4"]);
    expect(result.problems.every((problem) => problem.code === "project.material.invalid")).toBe(
      true,
    );
    expect(await projects.workflowCatalog(project.id)).toHaveLength(0);
  });

  it("shows draft-only workflows without a version and zero dispatches in the catalog (story 18)", async () => {
    const { projects } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const created = await projects.createWorkflowDraft(project.id, {
      name: "简历审核",
      description: "审核简历",
    });
    if (!created.ok) throw new Error("setup");
    const draft = created.value;
    const catalog = await projects.workflowCatalog(project.id);
    expect(catalog).toEqual([
      {
        workflowId: draft.id,
        projectId: project.id,
        name: "简历审核",
        description: "审核简历",
        status: "draft",
        latestVersionNumber: null,
        draftRevision: draft.revision,
        dispatchCount: 0,
        updatedAt: "2026-11-27T00:00:00.000Z",
      },
    ]);
  });

  it("reflects confirmed versions and real dispatch counts in the catalog", async () => {
    const { projects, workflow, setDispatchCounts } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const created = await projects.createWorkflowDraft(project.id, {
      name: "简历审核",
      description: "审核简历",
    });
    if (!created.ok) throw new Error("setup");
    const draft = created.value;
    await workflow.saveDraft(confirmableDraft(draft.id));
    const confirmed = await workflow.confirmDraft(draft.id);
    expect(confirmed.ok).toBe(true);
    setDispatchCounts({ [draft.id]: 3 });
    const catalog = await projects.workflowCatalog(project.id);
    const confirmedEntry = catalog.find((entry) => entry.workflowId === draft.id);
    expect(confirmedEntry?.status).toBe("confirmed");
    expect(confirmedEntry?.latestVersionNumber).toBe(1);
    expect(confirmedEntry?.dispatchCount).toBe(3);
  });

  it("keeps the workflow id globally unique so a version id can be traced from project cards to task rows (story 19 seam)", async () => {
    const { projects } = setup();
    const projectResult = await projects.createProject({ name: "校招项目" });
    if (!projectResult.ok) throw new Error("setup");
    const project = projectResult.value;
    const ra = await projects.createWorkflowDraft(project.id, { name: "流程 A" });
    const rb = await projects.createWorkflowDraft(project.id, { name: "流程 B" });
    if (!ra.ok || !rb.ok) throw new Error("setup");
    expect(ra.value.id).not.toBe(rb.value.id);
  });
});
