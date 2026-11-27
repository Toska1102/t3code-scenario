import { describe, expect, it } from "@effect/vitest";
import { planRedispatch, rematchFields } from "./redispatch.ts";
import { resumeReviewV1, resumeReviewV2, sampleTasks } from "./testFixtures.ts";

describe("planRedispatch", () => {
  it("从历史任务再派默认沿用任务的确切版本（D10）", () => {
    const task = sampleTasks.find((candidate) => candidate.number === "#018");
    if (!task) {
      throw new Error("fixture 任务缺失：#018");
    }
    const plan = planRedispatch({
      source: { kind: "task", task },
      versions: [resumeReviewV1, resumeReviewV2],
      tasks: sampleTasks,
    });
    expect(plan.selectedVersionId).toBe("wf-resume-v1");
    expect(plan.defaultVersionId).toBe("wf-resume-v1");
  });

  it("只能显式切换到同流程已确认版本", () => {
    const plan = planRedispatch({
      source: { kind: "version", versionId: "wf-resume-v1" },
      versions: [resumeReviewV1, resumeReviewV2],
      tasks: sampleTasks,
    });
    expect(plan.switchableVersions.map((version) => version.versionId)).toEqual([
      "wf-resume-v1",
      "wf-resume-v2",
    ]);
  });

  it("同版本任务列表只按版本 ID 过滤，不以同名流程代替（R01）", () => {
    const plan = planRedispatch({
      source: { kind: "version", versionId: "wf-resume-v1" },
      versions: [resumeReviewV1, resumeReviewV2],
      tasks: sampleTasks,
    });
    expect(plan.sameVersionTasks.map((task) => task.number)).toEqual(["#018", "#024", "#025"]);
  });

  it("切到 v2 后同版本列表跟随切换且为空", () => {
    const plan = planRedispatch({
      source: { kind: "version", versionId: "wf-resume-v1" },
      versions: [resumeReviewV1, resumeReviewV2],
      tasks: sampleTasks,
      selectedVersionId: "wf-resume-v2",
    });
    expect(plan.sameVersionTasks).toEqual([]);
  });
});

describe("rematchFields", () => {
  const values = { "field-role": "后端工程师", "field-req": "5 年经验" };

  it("默认不复用上次材料：同名字段保留为空", () => {
    const result = rematchFields(resumeReviewV1, resumeReviewV1.fields, values, false);
    expect(result.fields.every((field) => field.value === "")).toBe(true);
    expect(result.missingRequired.map((field) => field.id)).toEqual([
      "field-role",
      "field-req",
      "field-resume",
    ]);
  });

  it("明确选择复用后才沿用当前已输入的值", () => {
    const result = rematchFields(resumeReviewV1, resumeReviewV1.fields, values, true);
    expect(result.fields.find((field) => field.id === "field-role")?.value).toBe("后端工程师");
    expect(result.missingRequired.map((field) => field.id)).toEqual(["field-resume"]);
  });

  it("切到新增必填字段的版本时明确列出需补填项", () => {
    const result = rematchFields(resumeReviewV2, resumeReviewV1.fields, values, true);
    expect(result.newRequiredFieldIds).toEqual(["field-priority"]);
    expect(result.missingRequired.map((field) => field.id)).toContain("field-priority");
  });
});
