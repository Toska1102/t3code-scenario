// 组织样例与「简历审核 v1」快照，供票 06 测试复用（对应规格 #018/#024/#025 样例）。
import type {
  OrgRevision,
  TaskRecord,
  WorkflowStepSnapshot,
  WorkflowVersionSnapshot,
} from "./types.ts";

export const hrOrg: OrgRevision = {
  teamId: "team-hr",
  revision: 1,
  nodes: [
    { id: "node-hr", name: "HR 总管", executor: { kind: "person", id: "person-1" } },
    { id: "node-zp", name: "招聘主管", executor: { kind: "agent", id: "agent-zp" } },
    { id: "node-ta", name: "TA 专员", executor: { kind: "agent", id: "agent-ta" } },
  ],
  reviewRules: [{ taskType: "简历审核", reviewerNodeId: "node-hr", mandatory: true }],
};

export const resumeReviewV1: WorkflowVersionSnapshot = {
  versionId: "wf-resume-v1",
  workflowId: "wf-resume",
  workflowName: "简历审核",
  status: "confirmed",
  org: hrOrg,
  fields: [
    { id: "field-role", label: "岗位", kind: "short-text", required: true },
    { id: "field-req", label: "岗位要求", kind: "long-text", required: true },
    { id: "field-resume", label: "待审核简历", kind: "file", required: true },
  ],
  steps: [
    { id: "step-screen", name: "初审", orgNodeId: "node-ta", executorKind: "agent" },
    {
      id: "step-review",
      name: "HR 复核",
      orgNodeId: "node-hr",
      executorKind: "human",
      mandatoryReview: true,
      taskType: "简历审核",
    },
  ],
};

export const resumeReviewV2: WorkflowVersionSnapshot = {
  ...resumeReviewV1,
  versionId: "wf-resume-v2",
  fields: [
    ...resumeReviewV1.fields,
    { id: "field-priority", label: "优先级", kind: "short-text", required: true },
  ],
};

// 规格样例：#018、#024、#025 均调用「简历审核 v1」，合并口径为同一版本 3 条调用（R01）。
export const sampleTasks: TaskRecord[] = [
  {
    id: "task-18",
    number: "#018",
    title: "简历审核：后端工程师",
    workflowId: "wf-resume",
    versionId: "wf-resume-v1",
    orgRevision: 1,
    status: "已完成",
    role: "后端工程师",
    inputs: { "field-role": "后端工程师" },
  },
  {
    id: "task-24",
    number: "#024",
    title: "简历审核：前端工程师",
    workflowId: "wf-resume",
    versionId: "wf-resume-v1",
    orgRevision: 1,
    status: "待评审",
    role: "前端工程师",
    inputs: { "field-role": "前端工程师" },
  },
  {
    id: "task-25",
    number: "#025",
    title: "简历审核：前端工程师",
    workflowId: "wf-resume",
    versionId: "wf-resume-v1",
    orgRevision: 1,
    status: "已完成",
    role: "前端工程师",
    inputs: { "field-role": "前端工程师" },
  },
];

export function resumeReviewV1StepUsing(nodeId: string): WorkflowStepSnapshot {
  const step = resumeReviewV1.steps.find((candidate) => candidate.orgNodeId === nodeId);
  if (!step) {
    throw new Error(`fixture 步骤缺失：节点 ${nodeId}`);
  }
  return step;
}
