// 票 06：再次派发与组织版本的领域类型。
// 版本快照不可变；任务绑定派发时的确切版本 ID 与组织修订号（R01、D02、D10）。

export type DispatchFieldKind = "short-text" | "long-text" | "file";

export interface DispatchFieldDef {
  id: string;
  label: string;
  kind: DispatchFieldKind;
  required: boolean;
  description?: string;
}

export interface WorkflowStepSnapshot {
  id: string;
  name: string;
  orgNodeId?: string;
  executorKind?: "agent" | "human";
  tokenLimit?: number;
  tools?: string[];
  models?: string[];
  mandatoryReview?: boolean;
  taskType?: string;
}

export interface WorkflowVersionSnapshot {
  versionId: string;
  workflowId: string;
  workflowName: string;
  status: "draft" | "confirmed";
  fields: DispatchFieldDef[];
  steps: WorkflowStepSnapshot[];
  /** 确认时记录的组织修订，供提交时按同一版本复核（D02）。 */
  org: OrgRevision;
}

export type ExecutorBinding = { kind: "person"; id: string } | { kind: "agent"; id: string } | null;

export interface OrgNodeSnapshot {
  id: string;
  name: string;
  executor: ExecutorBinding;
  tokenLimit?: number;
  allowedTools?: string[];
  allowedModels?: string[];
}

export interface ReviewRuleSnapshot {
  taskType: string;
  reviewerNodeId: string;
  mandatory: boolean;
}

export interface OrgRevision {
  teamId: string;
  revision: number;
  nodes: OrgNodeSnapshot[];
  reviewRules: ReviewRuleSnapshot[];
}

export type TaskStatus = "运行中" | "待评审" | "待修改" | "待处理" | "已完成" | "失败" | "已取消";

export interface TaskRecord {
  id: string;
  number: string;
  title: string;
  workflowId: string;
  versionId: string;
  orgRevision: number;
  status: TaskStatus;
  /** 派发表单里的岗位，用于 03.02 同版本任务列表展示。 */
  role?: string;
  inputs: Record<string, string>;
  /** 幂等提交标识（D08）。 */
  submissionKey?: SubmissionKey;
}

/** 提交标识：同一次提交重试映射到同一任务（D08）。 */
export type SubmissionKey = string;
