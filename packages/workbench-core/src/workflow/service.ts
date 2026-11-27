import type {
  WorkflowDraft,
  WorkflowProblem,
  WorkflowResult,
  WorkflowVersionRecord,
} from "../../../workbench-contracts/src/workflow/types.ts";
import { parseGeneratedSteps, type WorkflowGenerator } from "./generator.ts";
import { coveragePreview } from "./members.ts";
import { confirmProblems } from "./validation.ts";
import type { WorkflowStore } from "./store.ts";

export interface WorkflowServicePorts {
  store: WorkflowStore;
  /** Current organization revision; confirm always validates against what this returns (D02 seam). */
  currentTeamGraph: () => Promise<
    import("../../../workbench-contracts/src/workflow/types.ts").TeamGraphSnapshot
  >;
  newId: (prefix: string) => string;
  now: () => string;
  actor: () => string;
  generator?: WorkflowGenerator;
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;

export interface NewDraftInput {
  name?: string;
  description?: string;
  inputFields?: WorkflowDraft["inputFields"];
  deliverable?: string;
  memberIds?: string[];
  /** 本次材料 registered at creation (story 17); the first dispatch may reuse them. */
  materials?: NonNullable<WorkflowDraft["materials"]>;
  baseVersionNumber?: number | null;
}

export function createWorkflowService(ports: WorkflowServicePorts) {
  const { store, newId, now, actor } = ports;

  async function createDraft(input: NewDraftInput = {}): Promise<WorkflowDraft> {
    const draft: WorkflowDraft = {
      id: newId("wf"),
      revision: 1,
      name: input.name ?? "",
      description: input.description ?? "",
      status: "draft",
      inputFields: input.inputFields ?? [],
      deliverable: input.deliverable ?? "",
      memberIds: input.memberIds ?? [],
      steps: [],
      materials: input.materials ?? [],
      baseVersionNumber: input.baseVersionNumber ?? null,
      lastConfirmedVersionNumber: null,
      lastConfirmedRevision: null,
    };
    await store.saveDraft(draft);
    return draft;
  }

  async function loadDraft(id: string): Promise<WorkflowDraft | null> {
    return store.getDraft(id);
  }

  /** Always saveable, even incomplete (story 26). Rejects stale revisions. */
  async function saveDraft(draft: WorkflowDraft): Promise<WorkflowResult<WorkflowDraft>> {
    const stored = await store.getDraft(draft.id);
    if (!stored) {
      if (draft.revision !== 1) {
        return { ok: false, problems: [revisionConflict()] };
      }
    } else if (draft.revision < stored.revision) {
      return { ok: false, problems: [revisionConflict()] };
    }
    const next: WorkflowDraft = { ...draft, revision: draft.revision + 1 };
    await store.saveDraft(next);
    return { ok: true, value: next };
  }

  function revisionConflict(): WorkflowProblem {
    return {
      code: "draft.revision.conflict",
      target: { kind: "workflow" },
      message: "这份草稿已被其他窗口修改，请刷新后重试。",
    };
  }

  async function listHistory(workflowId: string): Promise<WorkflowVersionRecord[]> {
    const versions = await store.listVersions(workflowId);
    return [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  }

  /**
   * 只确认工作流 (story 26): validation gates only — organization, structure,
   * inputs/outputs, members and review rules. Agent health, dispatch
   * materials and working directories never participate (D01), and nothing
   * here starts an execution.
   */
  async function confirmDraft(workflowId: string): Promise<WorkflowResult<WorkflowVersionRecord>> {
    const draft = await store.getDraft(workflowId);
    if (!draft) {
      return {
        ok: false,
        problems: [
          { code: "draft.notFound", target: { kind: "workflow" }, message: "找不到这份草稿。" },
        ],
      };
    }
    // Idempotent retry of the same submission returns the same version.
    if (
      draft.lastConfirmedVersionNumber !== null &&
      draft.lastConfirmedRevision === draft.revision
    ) {
      const existing = await store.getVersion(workflowId, draft.lastConfirmedVersionNumber);
      if (existing) return { ok: true, value: existing };
    }
    const graph = await ports.currentTeamGraph();
    const problems = confirmProblems(draft, graph);
    if (problems.length) return { ok: false, problems };
    const versions = await listHistory(workflowId);
    const record: WorkflowVersionRecord = {
      workflowId,
      versionNumber: (versions[versions.length - 1]?.versionNumber ?? 0) + 1,
      name: draft.name,
      description: draft.description,
      inputFields: draft.inputFields,
      deliverable: draft.deliverable,
      steps: draft.steps,
      confirmedAt: now(),
      confirmedBy: actor(),
    };
    await store.appendVersion(record);
    await store.saveDraft({
      ...draft,
      status: "confirmed",
      baseVersionNumber: record.versionNumber,
      lastConfirmedVersionNumber: record.versionNumber,
      lastConfirmedRevision: draft.revision,
    });
    return { ok: true, value: record };
  }

  /** 编辑流程 (story 27): an editable revision draft from a confirmed version. */
  async function startRevision(workflowId: string, versionNumber: number): Promise<WorkflowDraft> {
    const record = await store.getVersion(workflowId, versionNumber);
    if (!record) throw new Error(`未找到「${workflowId}」的版本 v${versionNumber}`);
    const stored = await store.getDraft(workflowId);
    const draft: WorkflowDraft = {
      id: workflowId,
      revision: stored ? stored.revision + 1 : 1,
      name: record.name,
      description: record.description,
      status: "draft",
      inputFields: record.inputFields,
      deliverable: record.deliverable,
      memberIds: [...new Set(record.steps.map((step) => step.ownerId))],
      steps: record.steps,
      baseVersionNumber: versionNumber,
      lastConfirmedVersionNumber: null,
      lastConfirmedRevision: null,
    };
    await store.saveDraft(draft);
    return draft;
  }

  /**
   * 重新生成草稿 (story 23). Generator output is untrusted data: it is parsed
   * and validated before it touches the draft, and a failure keeps the last
   * draft intact. Generated source is never executed.
   */
  async function generateSteps(workflowId: string): Promise<WorkflowResult<string[]>> {
    const generator = ports.generator;
    if (!generator) {
      return {
        ok: false,
        problems: [
          {
            code: "generator.output.invalid",
            target: { kind: "workflow" },
            message: "未接入项目助手生成器。",
          },
        ],
      };
    }
    const draft = await store.getDraft(workflowId);
    if (!draft) {
      return {
        ok: false,
        problems: [
          { code: "draft.notFound", target: { kind: "workflow" }, message: "找不到这份草稿。" },
        ],
      };
    }
    const graph = await ports.currentTeamGraph();
    const coverage = coveragePreview(graph, draft.memberIds, draft.name);
    const raw = await generator.generate({ draft, teamGraph: graph, coverage });
    const parsed = parseGeneratedSteps(raw, draft, graph);
    if (!parsed.ok) return parsed;
    await store.saveDraft({ ...draft, revision: draft.revision + 1, steps: parsed.value });
    return { ok: true, value: parsed.value.map((step) => step.id) };
  }

  return {
    createDraft,
    loadDraft,
    saveDraft,
    confirmDraft,
    startRevision,
    generateSteps,
    listHistory,
  };
}
