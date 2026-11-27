// 派发提交：同一次提交读取同一当前组织修订并落同一任务（D02、D08）。
// 兼容修订采用提交时读到的版本；不兼容不创建任务；草稿与缺必填输入不提交（R03、R04）。
import { classifyOrgChange, type OrgCompatibilityIssue } from "./orgCompatibility.ts";
import type { OrgRevision, SubmissionKey, TaskRecord, WorkflowVersionSnapshot } from "./types.ts";

export interface DispatchSubmissionDeps {
  readCurrentRevision: () => Promise<OrgRevision>;
  findTaskBySubmissionKey: (key: SubmissionKey) => Promise<TaskRecord | null>;
  createTask: (input: {
    submissionKey: SubmissionKey;
    versionId: string;
    orgRevision: number;
  }) => Promise<TaskRecord>;
}

export type DispatchSubmissionResult =
  | { outcome: "created"; task: TaskRecord }
  | { outcome: "existing"; task: TaskRecord }
  | { outcome: "incompatible"; issues: OrgCompatibilityIssue[]; revision: OrgRevision }
  | { outcome: "invalid-input"; reasons: string[] };

export async function submitRedispatch(
  deps: DispatchSubmissionDeps,
  request: {
    submissionKey: SubmissionKey;
    version: WorkflowVersionSnapshot;
    values: Record<string, string>;
  },
): Promise<DispatchSubmissionResult> {
  const existing = await deps.findTaskBySubmissionKey(request.submissionKey);
  if (existing) {
    return { outcome: "existing", task: existing };
  }

  const reasons: string[] = [];
  if (request.version.status !== "confirmed") {
    reasons.push("工作流尚未确认，不能派发");
  }
  for (const field of request.version.fields) {
    if (field.required && (request.values[field.id] ?? "") === "") {
      reasons.push(`缺少必填输入：${field.label}`);
    }
  }
  if (reasons.length > 0) {
    return { outcome: "invalid-input", reasons };
  }

  // 提交时读取一次组织修订，校验与任务登记使用同一版本（D02）。
  const revision = await deps.readCurrentRevision();
  const classification = classifyOrgChange(request.version.org, revision, request.version);
  if (!classification.compatible) {
    return { outcome: "incompatible", issues: classification.issues, revision };
  }

  const task = await deps.createTask({
    submissionKey: request.submissionKey,
    versionId: request.version.versionId,
    orgRevision: revision.revision,
  });
  return { outcome: "created", task };
}

// 兼容历史调用名。
export const createTaskIdempotently = submitRedispatch;
