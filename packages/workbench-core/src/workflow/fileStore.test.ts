import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createFileWorkflowStore } from "./fileStore.ts";
import type { WorkflowDraft } from "../../../workbench-contracts/src/workflow/types.ts";

function draft(id: string, revision = 1): WorkflowDraft {
  return {
    id,
    revision,
    name: "简历审核",
    description: "审核研发岗简历",
    status: "draft",
    inputFields: [
      { key: "position", label: "岗位", kind: "shortText", required: true, description: "" },
    ],
    deliverable: "审核建议",
    memberIds: [],
    steps: [],
    baseVersionNumber: null,
    lastConfirmedVersionNumber: null,
    lastConfirmedRevision: null,
  };
}

function tempDir(): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-store-"));
}

describe("file workflow store", () => {
  it("recovers drafts and versions from disk after a restart", async () => {
    const dir = tempDir();
    try {
      const first = await createFileWorkflowStore(dir);
      await first.saveDraft(draft("wf-1"));
      await first.saveDraft({ ...draft("wf-1", 2), name: "改名后" });
      await first.appendVersion({
        workflowId: "wf-1",
        versionNumber: 1,
        name: "简历审核",
        description: "审核研发岗简历",
        inputFields: draft("wf-1").inputFields,
        deliverable: "审核建议",
        steps: [],
        confirmedAt: "2026-11-27T00:00:00.000Z",
        confirmedBy: "admin",
      });

      const second = await createFileWorkflowStore(dir);
      expect(await second.getDraft("wf-1")).toMatchObject({
        id: "wf-1",
        revision: 2,
        name: "改名后",
      });
      expect((await second.listVersions("wf-1")).map((v) => v.versionNumber)).toEqual([1]);
      expect((await second.listDrafts()).map((d) => d.id)).toEqual(["wf-1"]);
      expect(await second.getVersion("wf-1", 1)).not.toBeNull();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps an empty store usable", async () => {
    const dir = tempDir();
    try {
      const store = await createFileWorkflowStore(dir);
      expect(await store.listDrafts()).toEqual([]);
      expect(await store.allVersions()).toEqual([]);
      expect(await store.getDraft("missing")).toBeNull();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
