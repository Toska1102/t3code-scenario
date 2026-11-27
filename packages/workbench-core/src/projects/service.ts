import type {
  ProjectProblem,
  ProjectResult,
  WorkflowCatalogEntry,
  WorkflowMaterial,
  WorkbenchProject,
} from "../../../workbench-contracts/src/project/types.ts";
import type {
  WorkflowDraft,
  WorkflowVersionRecord,
} from "../../../workbench-contracts/src/workflow/types.ts";
import type { ProjectRecord, ProjectStore } from "./store.ts";
import type { WorkflowStore } from "../workflow/store.ts";

export interface ProjectWorkflowPorts {
  loadDraft(workflowId: string): Promise<WorkflowDraft | null>;
  listHistory(workflowId: string): Promise<WorkflowVersionRecord[]>;
  createDraft(input: {
    name?: string;
    description?: string;
    materials?: WorkflowMaterial[];
  }): Promise<WorkflowDraft>;
}

export interface ProjectServicePorts {
  store: ProjectStore;
  /** Workflow drafts and versions live in the workflow store; the catalog reads through this port. */
  workflowStore: WorkflowStore;
  workflow: ProjectWorkflowPorts;
  /** Dispatch records belong to ticket 05; until then counts come from this port. */
  countDispatches(workflowId: string): Promise<number>;
  newId: (prefix: string) => string;
  now: () => string;
}

export type ProjectService = ReturnType<typeof createProjectService>;

export interface CreateProjectInput {
  name: string;
  description?: string;
  teamId?: string | null;
  teamName?: string;
}

export interface CreateWorkflowDraftInput {
  name?: string;
  description?: string;
  /** 本次材料 (story 17); validated before anything is created. */
  materials?: WorkflowMaterial[];
}

export function createProjectService(ports: ProjectServicePorts) {
  const { store, newId, now } = ports;
  // Concurrent submits with the same key must resolve to one draft: chain
  // them instead of racing check-then-set across await points.
  const inFlight = new Map<string, Promise<ProjectResult<WorkflowDraft>>>();

  async function createProject(
    input: CreateProjectInput,
  ): Promise<ProjectResult<WorkbenchProject>> {
    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        problems: [{ code: "project.name.required", message: "请填写项目名称。" }],
      };
    }
    const timestamp = now();
    const record: ProjectRecord = {
      id: newId("prj"),
      teamId: input.teamId ?? null,
      teamName: input.teamName ?? "",
      name,
      description: input.description ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await store.saveProject(record);
    return { ok: true, value: toProject(record) };
  }

  async function getProject(id: string): Promise<ProjectResult<WorkbenchProject>> {
    const record = await store.getProject(id);
    if (!record)
      return { ok: false, problems: [{ code: "project.notFound", message: "找不到这个项目。" }] };
    return { ok: true, value: toProject(record) };
  }

  async function listProjects(): Promise<WorkbenchProject[]> {
    const records = await store.listProjects();
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toProject);
  }

  /**
   * 创建任务工作流 (story 17): creation only ever enters a draft; a repeated
   * submit with the same key recovers the same draft, and a bad attachment
   * fails the whole submit with a per-file problem so callers keep their
   * other inputs.
   */
  async function createWorkflowDraft(
    projectId: string,
    input: CreateWorkflowDraftInput,
    options: { key?: string } = {},
  ): Promise<ProjectResult<WorkflowDraft>> {
    if (!options.key) return createWorkflowDraftOnce(projectId, input, options);
    const pending = inFlight.get(options.key) ?? createWorkflowDraftOnce(projectId, input, options);
    inFlight.set(options.key, pending);
    try {
      return await pending;
    } finally {
      if (inFlight.get(options.key) === pending) inFlight.delete(options.key);
    }
  }

  async function createWorkflowDraftOnce(
    projectId: string,
    input: CreateWorkflowDraftInput,
    options: { key?: string } = {},
  ): Promise<ProjectResult<WorkflowDraft>> {
    const project = await store.getProject(projectId);
    if (!project) {
      return { ok: false, problems: [{ code: "project.notFound", message: "找不到这个项目。" }] };
    }
    const materialProblems = materialProblemsOf(input.materials ?? []);
    if (materialProblems.length) return { ok: false, problems: materialProblems };
    if (options.key) {
      const existingId = await store.getIdempotentDraft(options.key);
      if (existingId) {
        const existing = await ports.workflow.loadDraft(existingId);
        if (existing) return { ok: true, value: existing };
      }
    }
    const draft = await ports.workflow.createDraft({
      name: input.name ?? "",
      description: input.description ?? "",
      materials: input.materials ?? [],
    });
    await store.recordWorkflow(projectId, draft.id, now());
    if (options.key) await store.setIdempotentDraft(options.key, draft.id);
    return { ok: true, value: draft };
  }

  /**
   * 流程目录 (story 18): one entry per workflow series with draft state,
   * latest confirmed version and the real dispatch count.
   */
  async function workflowCatalog(projectId: string): Promise<WorkflowCatalogEntry[]> {
    const [links, drafts, versions] = await Promise.all([
      store.workflowsOfProject(projectId),
      ports.workflowStore.listDrafts(),
      ports.workflowStore.allVersions(),
    ]);
    const entries: WorkflowCatalogEntry[] = [];
    for (const link of links) {
      const draft = drafts.find((candidate) => candidate.id === link.workflowId);
      if (!draft) continue;
      const history = versions.filter((record) => record.workflowId === link.workflowId);
      const latest = history.reduce<number | null>(
        (max, record) => (max === null || record.versionNumber > max ? record.versionNumber : max),
        null,
      );
      entries.push({
        workflowId: link.workflowId,
        projectId,
        name: draft.name,
        description: draft.description,
        status: latest !== null ? "confirmed" : "draft",
        latestVersionNumber: latest,
        draftRevision: draft.revision,
        dispatchCount: await ports.countDispatches(link.workflowId),
        updatedAt: link.createdAt,
      });
    }
    return entries;
  }

  return { createProject, getProject, listProjects, createWorkflowDraft, workflowCatalog };
}

/** Bare, non-empty, unique file names; paths are rejected before any IO. */
function materialProblemsOf(materials: WorkflowMaterial[]): ProjectProblem[] {
  const seen = new Set<string>();
  const problems: ProjectProblem[] = [];
  for (const material of materials) {
    const fileName = material.fileName.trim();
    let message: string | null = null;
    if (!fileName) message = "附件的文件名不能为空。";
    else if (fileName.includes("/") || fileName.includes("\\"))
      message = `「${fileName}」不是有效的文件名。`;
    else if (seen.has(fileName)) message = `「${fileName}」重复添加。`;
    if (message) {
      problems.push({
        code: "project.material.invalid",
        message,
        target: { kind: "material", id: material.id },
      });
    }
    seen.add(fileName);
  }
  return problems;
}

function toProject(record: ProjectRecord): WorkbenchProject {
  return {
    id: record.id,
    teamId: record.teamId,
    teamName: record.teamName,
    name: record.name,
    description: record.description,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
