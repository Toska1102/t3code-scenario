import type {
  WorkflowDraft,
  WorkflowVersionRecord,
} from "../../../workbench-contracts/src/workflow/types.ts";

/**
 * Persistence port for the workflow module. The parent integration owns the
 * SQLite implementation; the workbench ships the in-memory one for tests and
 * the standalone browser harness.
 */
export interface WorkflowStore {
  saveDraft(draft: WorkflowDraft): Promise<void>;
  getDraft(id: string): Promise<WorkflowDraft | null>;
  /** All drafts, for project catalogs. */
  listDrafts(): Promise<WorkflowDraft[]>;
  appendVersion(record: WorkflowVersionRecord): Promise<void>;
  getVersion(workflowId: string, versionNumber: number): Promise<WorkflowVersionRecord | null>;
  listVersions(workflowId: string): Promise<WorkflowVersionRecord[]>;
  /** All versions across workflows, for project catalogs. */
  allVersions(): Promise<WorkflowVersionRecord[]>;
}

export function createMemoryWorkflowStore(): WorkflowStore {
  const drafts = new Map<string, WorkflowDraft>();
  const versions = new Map<string, WorkflowVersionRecord[]>();
  return {
    saveDraft: async (draft) => {
      drafts.set(draft.id, draft);
    },
    getDraft: async (id) => drafts.get(id) ?? null,
    listDrafts: async () => [...drafts.values()],
    appendVersion: async (record) => {
      const list = versions.get(record.workflowId) ?? [];
      list.push(record);
      versions.set(record.workflowId, list);
    },
    getVersion: async (workflowId, versionNumber) =>
      (versions.get(workflowId) ?? []).find((record) => record.versionNumber === versionNumber) ??
      null,
    listVersions: async (workflowId) => [...(versions.get(workflowId) ?? [])],
    allVersions: async () => [...versions.values()].flat(),
  };
}
