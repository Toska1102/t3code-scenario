// 端到端用例追溯（票 06）：03.02 画板控件 → 领域调用。
// 版本横幅/切换（29、D10）→ planRedispatch；「本次输入」与材料复用（31）→ rematchFields；
// 「同一版本的已有任务」（R01）→ sameVersionTasks；「派发并运行」（D02、D08）→ submitRedispatch；04.01「再派一单」（41）。
import { describe, expect, it } from "@effect/vitest";
import { submitRedispatch, type DispatchSubmissionDeps } from "./dispatchSubmission.ts";
import { classifyOrgChange, type OrgCompatibilityIssue } from "./orgCompatibility.ts";
import { planRedispatch, rematchFields } from "./redispatch.ts";
import { invocationCountForVersion } from "./invocations.ts";
import { hrOrg, resumeReviewV1, resumeReviewV2, sampleTasks } from "./testFixtures.ts";
import type { OrgRevision, SubmissionKey, TaskRecord } from "./types.ts";

function makeStore(current: OrgRevision, existing: TaskRecord[] = sampleTasks) {
  const created: TaskRecord[] = [];
  const all = () => [...existing, ...created];
  const deps: DispatchSubmissionDeps = {
    readCurrentRevision: async () => current,
    findTaskBySubmissionKey: async (key: SubmissionKey) =>
      all().find((task) => task.submissionKey === key) ?? null,
    createTask: async (input: {
      submissionKey: SubmissionKey;
      versionId: string;
      orgRevision: number;
    }) => {
      const base = sampleTasks[0];
      if (!base) throw new Error("fixture 任务缺失");
      const task = {
        ...base,
        id: `task-new-${created.length + 1}`,
        number: `#0${30 + created.length}`,
        title: "简历审核：测试",
        versionId: input.versionId,
        orgRevision: input.orgRevision,
        status: "运行中" as const,
        submissionKey: input.submissionKey,
      };
      created.push(task);
      return task;
    },
  };
  return { deps, all };
}

const values = { "field-role": "测试工程师", "field-req": "3 年", "field-resume": "resume.pdf" };
const KEY: SubmissionKey = "submit-e2e-1";

describe("票 06 端到端：再次派发与组织版本", () => {
  it("03.02：从历史任务再派 → 显式切换 v2 → 复用材料并补新增必填 → 提交遇组织不兼容保留材料 → 修订后成功创建，调用计数随真实数据更新", async () => {
    // 入口 04.01「再派一单」：从已完成历史任务打开派发（41），历史仍可回看。
    const source = sampleTasks.find((task) => task.number === "#018");
    if (!source) throw new Error("fixture 任务缺失：#018");

    // 版本横幅默认沿用任务的确切版本（D10）。
    const plan = planRedispatch({
      source: { kind: "task", task: source },
      versions: [resumeReviewV1, resumeReviewV2],
      tasks: sampleTasks,
    });
    expect(plan.defaultVersionId).toBe("wf-resume-v1");

    // 「同一版本的已有任务」：v1 恰为规格样例三条调用 #018/#024/#025（R01）。
    expect(plan.sameVersionTasks.map((task) => task.number)).toEqual(["#018", "#024", "#025"]);
    expect(invocationCountForVersion(sampleTasks, "wf-resume-v1")).toBe(3);

    // 显式切换到 v2，列表跟随切换且同版本为空。
    const switched = planRedispatch({
      source: { kind: "task", task: source },
      versions: [resumeReviewV1, resumeReviewV2],
      tasks: sampleTasks,
      selectedVersionId: "wf-resume-v2",
    });
    expect(switched.sameVersionTasks).toEqual([]);

    // 「上次材料」明确选择复用：同名字段沿用，新增必填「优先级」明确列出（29、31）。
    const rematched = rematchFields(
      resumeReviewV2,
      resumeReviewV1.fields,
      { ...values, "field-priority": "" },
      true,
    );
    expect(rematched.fields.find((field) => field.id === "field-role")?.value).toBe("测试工程师");
    expect(rematched.newRequiredFieldIds).toEqual(["field-priority"]);
    expect(rematched.missingRequired.map((field) => field.id)).toEqual(["field-priority"]);

    // 组织在派发前发生不兼容变更（删除 TA 节点）：不创建任务，材料保留在输入中，
    // 问题定位到引用该节点的步骤并引导修订（14、31）。
    const brokenOrg: OrgRevision = {
      ...hrOrg,
      revision: 2,
      nodes: hrOrg.nodes.filter((node) => node.id !== "node-ta"),
    };
    const broken = makeStore(brokenOrg);
    const blocked = await submitRedispatch(broken.deps, {
      submissionKey: KEY,
      version: resumeReviewV2,
      values: { ...values, "field-priority": "高" },
    });
    expect(blocked.outcome).toBe("incompatible");
    if (blocked.outcome === "incompatible") {
      const located: OrgCompatibilityIssue[] = classifyOrgChange(
        hrOrg,
        brokenOrg,
        resumeReviewV2,
      ).issues;
      expect(located).toEqual(blocked.issues);
      expect(
        located.some((issue) => issue.kind === "node-removed" && issue.stepId === "step-screen"),
      ).toBe(true);
    }
    // 未创建任何新任务（保留材料，等待修订）。
    expect(broken.all()).toHaveLength(3);
    // 材料仍在（保留输入，用户不重填）。
    expect(values["field-role"]).toBe("测试工程师");

    // 管理员完成修订：重新挂回 TA 节点（ID 稳定、仅改显示名，兼容），提交读取当前修订并以其创建任务（D02、14）。
    const revisedOrg: OrgRevision = {
      ...brokenOrg,
      revision: 3,
      nodes: [
        { id: "node-ta", name: "人才甄选", executor: { kind: "agent", id: "agent-ta" } },
        ...brokenOrg.nodes,
      ],
    };
    const revised = makeStore(revisedOrg);
    const ok = await submitRedispatch(revised.deps, {
      submissionKey: KEY,
      version: resumeReviewV2,
      values: { ...values, "field-priority": "高" },
    });
    expect(ok.outcome).toBe("created");
    if (ok.outcome !== "created") throw new Error("预期创建成功");
    expect(ok.task.versionId).toBe("wf-resume-v2");
    expect(ok.task.orgRevision).toBe(3);

    // 调用计数随真实数据更新：v2 从 0 → 1，v1 仍为 3。
    const tasks = [...sampleTasks, ok.task];
    expect(invocationCountForVersion(tasks, "wf-resume-v2")).toBe(1);
    expect(invocationCountForVersion(tasks, "wf-resume-v1")).toBe(3);
  });

  it("网络结果未知时以同一提交标识重试，取回同一任务（D08）", async () => {
    const org = makeStore(hrOrg, []);
    const first = await submitRedispatch(org.deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values,
    });
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") throw new Error("预期创建成功");

    const retry = makeStore(hrOrg, [...sampleTasks, first.task]);
    const again = await submitRedispatch(retry.deps, {
      submissionKey: KEY,
      version: resumeReviewV1,
      values,
    });
    expect(again).toEqual({ outcome: "existing", task: first.task });
    expect(retry.all()).toHaveLength(4);
  });
});
