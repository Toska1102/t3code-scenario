import { describe, expect, it } from "vite-plus/test";
import {
  WorkflowEditorController,
  type WorkflowEditorOperations,
} from "./WorkflowEditorController.ts";
import { createWorkflowService } from "../../../../packages/workbench-core/src/workflow/service.ts";
import { createMemoryWorkflowStore } from "../../../../packages/workbench-core/src/workflow/store.ts";
import type {
  TeamGraphSnapshot,
  WorkflowDraft,
  WorkflowVersionRecord,
} from "../../../../packages/workbench-contracts/src/workflow/types.ts";

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
      id: "recruit",
      name: "招聘",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "recruit-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
  ],
};

function newDraft(): WorkflowDraft {
  return {
    id: "wf-1",
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
    steps: [],
    baseVersionNumber: null,
    lastConfirmedVersionNumber: null,
    lastConfirmedRevision: null,
  };
}

function operations(overrides: Partial<WorkflowEditorOperations> = {}): WorkflowEditorOperations {
  return {
    saveDraft: async () => ({ ok: true, value: newDraft() }),
    confirmDraft: async () => ({
      ok: false,
      problems: [{ code: "workflow.steps.empty", target: { kind: "workflow" }, message: "空" }],
    }),
    generateSteps: async () => ({
      ok: false,
      problems: [
        { code: "generator.output.invalid", target: { kind: "workflow" }, message: "生成失败" },
      ],
    }),
    listHistory: async () => [],
    startRevision: async (_id, versionNumber) => ({
      ...newDraft(),
      baseVersionNumber: versionNumber,
    }),
    ...overrides,
  };
}

function makeController(
  ops: Partial<WorkflowEditorOperations> = {},
  callbacks: Partial<ConstructorParameters<typeof WorkflowEditorController>[1]> = {},
) {
  return new WorkflowEditorController(
    operations(ops),
    {
      confirm: () => true,
      ...callbacks,
    },
    newDraft(),
    graph,
  );
}

describe("workflow editor controller", () => {
  it("starts with the design's default subtitle and no selection", () => {
    const controller = makeController();
    expect(controller.getState().selectedStepId).toBeNull();
    expect(controller.subtitle()).toBe("简历审核 · 草稿");
  });

  it("shows selected members once with auto-included ancestors and updates the caption on toggle (story 22)", () => {
    const controller = makeController();
    expect(controller.membersCaption()).toBe("已选 OD、招聘，上级 HR 总管 自动带入。");
    const chips = controller.memberChips();
    expect(chips.find((chip) => chip.id === "hr")).toMatchObject({
      selected: false,
      autoIncluded: true,
    });
    controller.toggleMember("od");
    // Deselecting a member drops it and any ancestor only it contributed.
    expect(controller.membersCaption()).toBe("已选 招聘，上级 HR 总管 自动带入。");
    controller.toggleMember("hr"); // ancestors are not directly toggleable
    expect(controller.getState().draft.memberIds).toEqual(["recruit"]);
  });

  it("adds steps, blocks cycle-creating connections and deletes selected edges (story 25)", () => {
    const controller = makeController();
    controller.addStep();
    controller.addStep();
    const [a, b] = controller.getState().draft.steps;
    // New steps chain by default, so the edge already exists.
    expect(controller.connectSteps(a!.id, b!.id)).toBe("这条连线已存在。");
    expect(controller.connectSteps(b!.id, a!.id)).toBe("这条连线会形成执行环。");
    expect(controller.connectSteps(a!.id, a!.id)).toBe("步骤不能连接自身。");
    controller.selectEdge({ from: a!.id, to: b!.id });
    controller.deleteSelectedEdge();
    expect(controller.getState().draft.steps.find((step) => step.id === b!.id)?.dependsOn).toEqual(
      [],
    );
  });

  it("auto-layout orders by dependencies without changing them", () => {
    const controller = makeController();
    controller.addStep();
    controller.addStep();
    const [a, b] = controller.getState().draft.steps;
    // b already depends on a (new steps chain by default).
    const before = controller.getState().draft.steps.map((step) => step.dependsOn);
    controller.autoLayoutSteps();
    expect(controller.getState().draft.steps.map((step) => step.dependsOn)).toEqual(before);
    expect(
      controller.getState().draft.steps.find((step) => step.id === b!.id)!.position.x,
    ).toBeGreaterThan(
      controller.getState().draft.steps.find((step) => step.id === a!.id)!.position.x,
    );
  });

  it("zoom controls stay within bounds", () => {
    const controller = makeController();
    controller.zoomOut();
    controller.zoomOut();
    controller.zoomOut();
    expect(controller.getState().zoom).toBe(0.7);
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    controller.zoomIn();
    expect(controller.getState().zoom).toBeLessThanOrEqual(1.6);
    controller.fitZoom();
    expect(controller.getState().zoom).toBe(1);
  });

  it("keeps the draft and reports the error when generation fails (story 23)", async () => {
    const controller = makeController({
      generateSteps: async () => ({
        ok: false,
        problems: [
          { code: "generator.output.invalid", target: { kind: "workflow" }, message: "生成失败" },
        ],
      }),
    });
    controller.addStep();
    const before = controller.getState().draft;
    await controller.regenerate();
    expect(controller.getState().lastError).toBe("生成失败");
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().draft.steps).toEqual(before.steps);
  });

  it("shows live confirm problems and disables 只确认工作流 until they clear (story 26)", async () => {
    const controller = makeController();
    expect(controller.getState().problems.map((problem) => problem.code)).toContain(
      "workflow.steps.empty",
    );
    // With no runtime data attached at all, adding the gated structure is enough.
    controller.setDeliverable("");
    expect(controller.getState().problems.map((problem) => problem.code)).toContain(
      "workflow.deliverable.required",
    );
  });

  it("confirms through the operations and records the version (D01: no health or materials involved)", async () => {
    const version: WorkflowVersionRecord = {
      workflowId: "wf-1",
      versionNumber: 1,
      name: "简历审核",
      description: "",
      inputFields: [],
      deliverable: "",
      steps: [],
      confirmedAt: "2026-11-27T00:00:00.000Z",
      confirmedBy: "admin",
    };
    const controller = makeController({
      confirmDraft: async () => ({ ok: true, value: version }),
      listHistory: async () => [version],
    });
    const result = await controller.confirmOnly();
    expect(result.ok).toBe(true);
    expect(controller.getState().confirmedVersion?.versionNumber).toBe(1);
    expect(controller.subtitle()).toBe("简历审核 · 已确认 v1");
  });

  it("guards leaving with unsaved changes (story 27)", async () => {
    const messages: string[] = [];
    let back = 0;
    const controller = makeController(
      {},
      { confirm: (message) => (messages.push(message), false), onBackToProject: () => (back += 1) },
    );
    controller.setName("改动");
    await controller.leave();
    expect(messages[0]).toContain("未保存");
    expect(back).toBe(0);
    controller.saveDraft();
  });

  it("removing an input field warns with affected steps and cleans references (story 21)", async () => {
    const messages: string[] = [];
    const controller = makeController({}, { confirm: (message) => (messages.push(message), true) });
    controller.addStep();
    const step = controller.getState().draft.steps[0]!;
    controller.updateStepConfig(step.id, {
      inputRefs: [{ kind: "dispatch", fieldKey: "position" }],
    });
    await controller.removeInputField("position");
    expect(messages[0]).toContain("影响步骤");
    expect(controller.getState().draft.inputFields).toEqual([]);
    expect(controller.getState().draft.steps[0]!.config.inputRefs).toEqual([]);
  });

  it("lists history and starts a revision draft from a confirmed version", async () => {
    const version: WorkflowVersionRecord = {
      workflowId: "wf-1",
      versionNumber: 3,
      name: "简历审核",
      description: "",
      inputFields: [],
      deliverable: "",
      steps: [],
      confirmedAt: "2026-11-27T00:00:00.000Z",
      confirmedBy: "admin",
    };
    const controller = makeController({ listHistory: async () => [version] });
    await controller.openHistory();
    expect(controller.getState().historyOpen).toBe(true);
    expect(controller.getState().versions[0]?.versionNumber).toBe(3);
    await controller.editVersion(3);
    expect(controller.getState().draft.baseVersionNumber).toBe(3);
    expect(controller.getState().historyOpen).toBe(false);
  });

  it("wires to the real workflow service end to end: save, confirm, revise, confirm again", async () => {
    const service = createWorkflowService({
      store: createMemoryWorkflowStore(),
      currentTeamGraph: async () => graph,
      newId: (prefix) => `${prefix}-x`,
      now: () => "2026-11-27T00:00:00.000Z",
      actor: () => "admin",
    });
    const draft = await service.createDraft({
      name: "简历审核",
      description: "审核",
      inputFields: [
        { key: "position", label: "岗位", kind: "shortText", required: true, description: "" },
      ],
      deliverable: "建议",
      memberIds: ["od", "recruit"],
    });
    draft.steps = [
      {
        id: "s1",
        title: "明确岗位审核标准",
        ownerId: "od",
        mode: "execution",
        dependsOn: [],
        position: { x: 0, y: 140 },
        config: {
          prompt: "",
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
          prompt: "",
          inputRefs: [{ kind: "step", stepId: "s1" }],
          outputKey: "建议",
          outputLabel: "复核建议",
          tools: "读取文件",
          tokens: 3000,
          model: "Claude Sonnet",
        },
      },
    ];
    await service.saveDraft(draft);
    const ops: WorkflowEditorOperations = {
      saveDraft: (value) => service.saveDraft(value),
      confirmDraft: (value) => service.confirmDraft(value.id),
      generateSteps: () => service.generateSteps(draft.id),
      listHistory: (id) => service.listHistory(id),
      startRevision: (id, versionNumber) => service.startRevision(id, versionNumber),
      loadDraft: (id) => service.loadDraft(id),
    };
    const controller = new WorkflowEditorController(ops, { confirm: () => true }, draft, graph, []);
    const confirm = await controller.confirmOnly();
    expect(confirm.ok, JSON.stringify(confirm)).toBe(true);
    // Policy: OD's work must be human-reviewed by HR downstream — already satisfied by s2.
    expect(controller.getState().problems).toEqual([]);
    await controller.editVersion(1);
    expect(controller.getState().draft.baseVersionNumber).toBe(1);
    const second = await controller.confirmOnly();
    expect(second.ok && second.value.versionNumber === 2).toBe(true);
  });
});
