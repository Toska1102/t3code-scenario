import { describe, expect, it } from "vite-plus/test";
import {
  CreateWorkflowPanelController,
  type CreateWorkflowPanelOperations,
} from "./CreateWorkflowPanelController.ts";
import { createProjectService } from "../../../../packages/workbench-core/src/projects/service.ts";
import { createMemoryProjectStore } from "../../../../packages/workbench-core/src/projects/store.ts";
import { createWorkflowService } from "../../../../packages/workbench-core/src/workflow/service.ts";
import { createMemoryWorkflowStore } from "../../../../packages/workbench-core/src/workflow/store.ts";
import type { TeamGraphSnapshot } from "../../../../packages/workbench-contracts/src/workflow/types.ts";

function operations(
  overrides: Partial<CreateWorkflowPanelOperations> = {},
): CreateWorkflowPanelOperations {
  const created: Array<{ id: string }> = [];
  let n = 0;
  return {
    createWorkflowDraft: async (input) => {
      n += 1;
      created.push({ id: `wf-${n}` });
      return {
        ok: true,
        value: {
          id: `wf-${n}`,
          revision: 1,
          name: "",
          description: input.description ?? "",
          status: "draft",
          inputFields: [],
          deliverable: "",
          memberIds: [],
          steps: [],
          materials: input.materials,
          baseVersionNumber: null,
          lastConfirmedVersionNumber: null,
          lastConfirmedRevision: null,
        },
      };
    },
    ...overrides,
  };
}

function makePanel(ops: Partial<CreateWorkflowPanelOperations> = {}) {
  const onCreated: Array<{ id: string }> = [];
  const controller = new CreateWorkflowPanelController(operations(ops), {
    onCreated: (draft) => onCreated.push({ id: draft.id }),
  });
  return { controller, onCreated };
}

describe("create workflow panel controller (02.01 新建任务工作流, story 17)", () => {
  it("tracks description and attachments with the design's caption", () => {
    const { controller } = makePanel();
    expect(controller.getState().description).toBe("");
    expect(controller.caption()).toBe("尚未添加附件");
    controller.setDescription("我想审核一批研发岗简历。");
    controller.addFile("张三-研发岗简历.pdf");
    controller.addFile("岗位要求.pdf");
    expect(controller.caption()).toBe("已附 2 份文件");
    expect(controller.getState().materials.map((material) => material.fileName)).toEqual([
      "张三-研发岗简历.pdf",
      "岗位要求.pdf",
    ]);
  });

  it("removes and replaces a single attachment without touching the others", () => {
    const { controller } = makePanel();
    controller.addFile("a.pdf");
    controller.addFile("b.pdf");
    controller.addFile("c.pdf");
    controller.removeFile(controller.getState().materials[1]!.id);
    expect(controller.caption()).toBe("已附 2 份文件");
    expect(controller.getState().materials.map((material) => material.fileName)).toEqual([
      "a.pdf",
      "c.pdf",
    ]);
    controller.replaceFile(controller.getState().materials[0]!.id, "a2.pdf");
    expect(controller.getState().materials.map((material) => material.fileName)).toEqual([
      "a2.pdf",
      "c.pdf",
    ]);
  });

  it("marks a bad file locally and keeps the other inputs", () => {
    const { controller } = makePanel();
    controller.setDescription("描述");
    controller.addFile("a.pdf");
    controller.addFile("../etc/passwd");
    const bad = controller.getState().materials[1]!;
    expect(controller.fileError(bad.id)).toContain("文件名");
    expect(controller.getState().description).toBe("描述");
    expect(controller.fileError(controller.getState().materials[0]!.id)).toBeNull();
    // Fixing the file clears its mark.
    controller.replaceFile(bad.id, "好简历.pdf");
    expect(controller.fileError(bad.id)).toBeNull();
  });

  it("submits once with a stable key; a second submit recovers the same draft", async () => {
    let calls = 0;
    const { controller, onCreated } = makePanel({
      createWorkflowDraft: async (input) => {
        calls += 1;
        return {
          ok: true,
          value: {
            id: "wf-same",
            revision: 1,
            name: "",
            description: input.description ?? "",
            status: "draft",
            inputFields: [],
            deliverable: "",
            memberIds: [],
            steps: [],
            baseVersionNumber: null,
            lastConfirmedVersionNumber: null,
            lastConfirmedRevision: null,
          },
        };
      },
    });
    controller.setDescription("审核简历");
    controller.addFile("a.pdf");
    await controller.submit();
    expect(calls).toBe(1);
    await controller.submit();
    expect(calls).toBe(1); // already created; same draft returned without a second call
    expect(onCreated).toEqual([{ id: "wf-same" }]);
  });

  it("on failure marks the offending file from the server problems and preserves the other inputs", async () => {
    const { controller } = makePanel({
      createWorkflowDraft: async (input) => {
        const bad = input.materials.find(
          (material) => !material.fileName.trim() || /[\\/]/.test(material.fileName),
        );
        return bad
          ? {
              ok: false,
              problems: [
                {
                  code: "project.material.invalid",
                  message: "文件名不能为空。",
                  target: { kind: "material", id: bad.id },
                },
              ],
            }
          : {
              ok: true,
              value: {
                id: "wf-x",
                revision: 1,
                name: "",
                description: input.description ?? "",
                status: "draft",
                inputFields: [],
                deliverable: "",
                memberIds: [],
                steps: [],
                baseVersionNumber: null,
                lastConfirmedVersionNumber: null,
                lastConfirmedRevision: null,
              },
            };
      },
    });
    controller.setDescription("审核简历");
    controller.addFile("好.pdf");
    controller.addFile("");
    const badId = controller.getState().materials[1]!.id;
    await controller.submit();
    expect(controller.fileError(badId)).toBe("文件名不能为空。");
    // Per-file problems stay on the file; no global error banner.
    expect(controller.getState().lastError).toBeNull();
    expect(controller.getState().description).toBe("审核简历");
    expect(controller.getState().materials).toHaveLength(2);
    expect(controller.fileError(controller.getState().materials[0]!.id)).toBeNull();
  });

  it("creates the draft through the real project service and carries the materials (end to end)", async () => {
    const graph: TeamGraphSnapshot = {
      teamId: "team-1",
      teamName: "招聘运营",
      revision: 1,
      nodes: [],
    };
    const workflowStore = createMemoryWorkflowStore();
    const workflow = createWorkflowService({
      store: workflowStore,
      currentTeamGraph: async () => graph,
      newId: (prefix) => `${prefix}-x`,
      now: () => "2026-11-27T00:00:00.000Z",
      actor: () => "admin",
    });
    const projects = createProjectService({
      store: createMemoryProjectStore(),
      workflowStore,
      workflow: {
        loadDraft: (id) => workflow.loadDraft(id),
        listHistory: (id) => workflow.listHistory(id),
        createDraft: (input) => workflow.createDraft(input),
      },
      countDispatches: async () => 0,
      newId: (prefix) => `${prefix}-x`,
      now: () => "2026-11-27T00:00:00.000Z",
    });
    const project = await projects.createProject({ name: "校招项目" });
    if (!project.ok) throw new Error("setup");
    const { controller, onCreated } = makePanel({
      createWorkflowDraft: (input) =>
        projects.createWorkflowDraft(project.value.id, input, { key: controller.submitKey() }),
    });
    controller.setDescription(
      "我想审核一批研发岗简历。请整理每份简历和岗位要求的匹配依据，再由 HR 总管复核。",
    );
    controller.addFile("张三-研发岗简历.pdf");
    controller.addFile("岗位要求.pdf");
    await controller.submit();
    expect(onCreated).toHaveLength(1);
    const stored = await workflow.loadDraft(onCreated[0]!.id);
    expect(stored?.materials?.map((material) => material.fileName)).toEqual([
      "张三-研发岗简历.pdf",
      "岗位要求.pdf",
    ]);
  });
});
