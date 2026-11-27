// @effect-diagnostics nodeBuiltinImport:off -- This filesystem adapter works with local project files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type {
  WorkflowDraft,
  WorkflowVersionRecord,
} from "../../../../workbench-contracts/src/workflow/types.ts";
import type { WorkflowStore } from "../../../../workbench-core/src/workflow/store.ts";

/**
 * JSON-file persistence for the standalone workbench server: drafts are whole
 * files, versions append-only JSONL; every write is temp-file + rename so a
 * crash never leaves a torn file.
 */
export async function createFileWorkflowStore(stateDir: string): Promise<WorkflowStore> {
  const draftsDir = NodePath.join(stateDir, "drafts");
  const versionsDir = NodePath.join(stateDir, "versions");
  for (const dir of [stateDir, draftsDir, versionsDir]) {
    if (!NodeFS.existsSync(dir)) NodeFS.mkdirSync(dir, { recursive: true });
  }

  const draftPath = (workflowId: string) =>
    NodePath.join(draftsDir, `${sanitize(workflowId)}.json`);
  const versionsPath = (workflowId: string) =>
    NodePath.join(versionsDir, `${sanitize(workflowId)}.jsonl`);

  function writeAtomic(path: string, data: string): void {
    const tmp = `${path}.tmp`;
    NodeFS.writeFileSync(tmp, data, "utf8");
    NodeFS.renameSync(tmp, path);
  }

  function readDraft(workflowId: string): WorkflowDraft | null {
    const path = draftPath(workflowId);
    if (!NodeFS.existsSync(path)) return null;
    return JSON.parse(NodeFS.readFileSync(path, "utf8")) as WorkflowDraft;
  }

  function readVersions(workflowId: string): WorkflowVersionRecord[] {
    const path = versionsPath(workflowId);
    if (!NodeFS.existsSync(path)) return [];
    return NodeFS.readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as WorkflowVersionRecord);
  }

  return {
    saveDraft: async (draft) => writeAtomic(draftPath(draft.id), JSON.stringify(draft)),
    getDraft: async (id) => readDraft(id),
    listDrafts: async () => {
      const { readdirSync } = await import("node:fs");
      return readdirSync(draftsDir)
        .filter((name) => name.endsWith(".json"))
        .map(
          (name) =>
            JSON.parse(
              NodeFS.readFileSync(NodePath.join(draftsDir, name), "utf8"),
            ) as WorkflowDraft,
        );
    },
    appendVersion: async (record) => {
      const list = readVersions(record.workflowId);
      list.push(record);
      writeAtomic(
        versionsPath(record.workflowId),
        list.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      );
    },
    getVersion: async (workflowId, versionNumber) =>
      readVersions(workflowId).find((record) => record.versionNumber === versionNumber) ?? null,
    listVersions: async (workflowId) => readVersions(workflowId),
    allVersions: async () => {
      const { readdirSync } = await import("node:fs");
      return readdirSync(versionsDir)
        .filter((name) => name.endsWith(".jsonl"))
        .flatMap((name) =>
          NodeFS.readFileSync(NodePath.join(versionsDir, name), "utf8")
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line) as WorkflowVersionRecord),
        );
    },
  };
}

function sanitize(workflowId: string): string {
  // Ids come from newId("wf") and are path-safe in practice; this guards the
  // file layout anyway since ids are client-visible data.
  return workflowId.replace(/[^A-Za-z0-9._-]/g, "_");
}
