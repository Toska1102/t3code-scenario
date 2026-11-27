import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createFileProjectStore } from "./fileStore.ts";

const project = {
  id: "prj-1",
  teamId: "team-1",
  teamName: "招聘运营",
  name: "校招项目",
  description: "",
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

describe("file project store", () => {
  it("recovers projects, idempotency keys and memberships after a restart", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-projects-"));
    try {
      const first = await createFileProjectStore(dir);
      await first.saveProject(project);
      await first.setIdempotentDraft("submit-1", "wf-1");
      await first.recordWorkflow("prj-1", "wf-1", "2026-11-27T00:00:00.000Z");

      const second = await createFileProjectStore(dir);
      expect(await second.getProject("prj-1")).toMatchObject({ id: "prj-1", name: "校招项目" });
      expect((await second.listProjects()).map((p) => p.id)).toEqual(["prj-1"]);
      expect(await second.getIdempotentDraft("submit-1")).toBe("wf-1");
      expect(await second.workflowsOfProject("prj-1")).toEqual([
        { workflowId: "wf-1", createdAt: "2026-11-27T00:00:00.000Z" },
      ]);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
