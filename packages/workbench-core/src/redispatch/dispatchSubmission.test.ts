import { describe, expect, it } from "@effect/vitest";
import { createTaskIdempotently } from "./dispatchSubmission.ts";
import { classifyOrgChange } from "./orgCompatibility.ts";
import { hrOrg, resumeReviewV1, resumeReviewV2 } from "./testFixtures.ts";
import type { OrgRevision, SubmissionKey, TaskRecord } from "./types.ts";

function makeDeps(current: OrgRevision, options?: { existing?: TaskRecord[] }) {
  const created: Array<{
    submissionKey: SubmissionKey;
    versionId: string;
    orgRevision: number;
  }> = [];
  return {
    created,
    deps: {
      readCurrentRevision: async () => current,
      findTaskBySubmissionKey: async (key: SubmissionKey) =>
        options?.existing?.find((task) => task.submissionKey === key) ?? null,
      createTask: async (input: {
        submissionKey: SubmissionKey;
        versionId: string;
        orgRevision: number;
      }) => {
        created.push(input);
        return {
          id: `task-new-${created.length}`,
          number: `#0${30 + created.length}`,
          title: "简历审核：测试",
          workflowId: "wf-resume",
          versionId: input.versionId,
          orgRevision: input.orgRevision,
          status: "运行中",
          inputs: {},
          submissionKey: input.submissionKey,
        } satisfies TaskRecord;
      },
    },
  };
}

const KEY: SubmissionKey = "submit-1";

describe("submitRedispatch", () => {
  it("提交时读取当前组织修订，兼容时以该修订创建任务（D02）", async () => {
    const renamed = {
      ...hrOrg,
      revision: 2,
      nodes: hrOrg.nodes.map((node) =>
        node.id === "node-ta" ? { ...node, name: "人才甄选" } : node,
      ),
    };
    const { deps, created } = makeDeps(renamed);
    const result = await createTaskIdempotently(deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values: { "field-role": "后端工程师", "field-req": "3 年", "field-resume": "a.pdf" },
    });
    expect(result.outcome).toBe("created");
    expect(created).toEqual([{ submissionKey: KEY, versionId: "wf-resume-v1", orgRevision: 2 }]);
  });

  it("组织修订不兼容时不创建任务并保留原因", async () => {
    const removedTa = {
      ...hrOrg,
      revision: 2,
      nodes: hrOrg.nodes.filter((node) => node.id !== "node-ta"),
    };
    const { deps, created } = makeDeps(removedTa);
    const result = await createTaskIdempotently(deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values: { "field-role": "后端工程师", "field-req": "3 年", "field-resume": "a.pdf" },
    });
    expect(result.outcome).toBe("incompatible");
    if (result.outcome === "incompatible") {
      expect(classifyOrgChange(hrOrg, removedTa, resumeReviewV1).issues).toEqual(result.issues);
    }
    expect(created).toEqual([]);
  });

  it("同一提交标识重试返回同一任务，不重复创建（D08）", async () => {
    const first = makeDeps(hrOrg);
    const created = await createTaskIdempotently(first.deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values: { "field-role": "后端工程师", "field-req": "3 年", "field-resume": "a.pdf" },
    });
    expect(created.outcome).toBe("created");
    const task = (created as { task: TaskRecord }).task;

    const retry = makeDeps(hrOrg, { existing: [task] });
    const result = await createTaskIdempotently(retry.deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values: { "field-role": "后端工程师", "field-req": "3 年", "field-resume": "a.pdf" },
    });
    expect(result).toEqual({ outcome: "existing", task });
    expect(retry.created).toEqual([]);
  });

  it("缺失必填输入时不提交", async () => {
    const { deps, created } = makeDeps(hrOrg);
    const result = await createTaskIdempotently(deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values: { "field-role": "后端工程师" },
    });
    expect(result.outcome).toBe("invalid-input");
    expect(created).toEqual([]);
  });

  it("草稿版本不可派发", async () => {
    const { deps, created } = makeDeps(hrOrg);
    const result = await createTaskIdempotently(deps, {
      submissionKey: KEY,
      version: { ...resumeReviewV2, status: "draft" },
      values: { "field-role": "后端", "field-req": "3 年", "field-resume": "a.pdf" },
    });
    expect(result.outcome).toBe("invalid-input");
    expect(created).toEqual([]);
  });
});
