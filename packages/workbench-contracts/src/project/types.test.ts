import { describe, expect, it } from "vite-plus/test";
import {
  DISPATCH_COUNT_UNIT,
  materialCountCaption,
  workflowCatalogSummary,
  type WorkflowCatalogEntry,
  type WorkbenchProject,
} from "./types.ts";

describe("project contracts", () => {
  it("shows the attachment count caption from the 02.01 design (story 17)", () => {
    expect(materialCountCaption(6)).toBe("已附 6 份文件");
    expect(materialCountCaption(0)).toBe("尚未添加附件");
  });

  it("keeps project identity stable across renames", () => {
    const project: WorkbenchProject = {
      id: "prj-1",
      teamId: "team-1",
      teamName: "招聘运营",
      name: " 校招 ",
      description: "",
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    expect(project.id).toBe("prj-1");
  });

  it("summarizes catalog entries with real dispatch counts", () => {
    const entry: WorkflowCatalogEntry = {
      workflowId: "wf-1",
      projectId: "prj-1",
      name: "简历审核",
      description: "审核研发岗简历",
      status: "confirmed",
      latestVersionNumber: 1,
      draftRevision: 3,
      dispatchCount: 2,
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    const line = workflowCatalogSummary(entry);
    expect(line).toContain("v1");
    expect(line).toContain(`${entry.dispatchCount} ${DISPATCH_COUNT_UNIT}`);
  });

  it("shows draft-only workflows without a version", () => {
    const entry: WorkflowCatalogEntry = {
      workflowId: "wf-2",
      projectId: "prj-1",
      name: "简历审核",
      description: "",
      status: "draft",
      latestVersionNumber: null,
      draftRevision: 1,
      dispatchCount: 0,
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    expect(workflowCatalogSummary(entry)).toContain("草稿");
  });
});
