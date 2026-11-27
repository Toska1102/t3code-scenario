import type { TaskDetailSnapshot } from "./domain";
import type { TeamInfo, TaskSummary } from "./ports";

/**
 * Demo adapter fixtures mapped from the 04.01 design sample. This is the
 * data-mapping adapter at the port boundary; a real T3-backed adapter
 * implements the same ports. No real T3 or AgentTrail evidence exists in this
 * worktree — the integration items stay pending acceptance per the spec.
 */

export interface DemoProject {
  readonly projectName: string;
  readonly team: TeamInfo;
  readonly tasks: readonly TaskSummary[];
  readonly snapshots: ReadonlyMap<string, TaskDetailSnapshot>;
}

export function buildDemoProject(): DemoProject {
  const projectName = "招聘运营";
  const team: TeamInfo = {
    name: "HR 团队",
    description: "负责组织发展与人力资源运营",
    establishedAt: "2026-11-02",
    nodeCount: 12,
  };

  const tasks: readonly TaskSummary[] = [
    { taskId: "t25", title: "产品经理简历审核 #025", status: "done" },
    { taskId: "t24", title: "产品经理简历审核 #024", status: "awaiting-review" },
    { taskId: "t18", title: "研发简历审核 #018", status: "done" },
  ];

  const t25: TaskDetailSnapshot = {
    taskId: "t25",
    title: "产品经理简历审核 #025",
    status: "done",
    workflowVersion: "简历审核 v1",
    completedSteps: 4,
    totalSteps: 4,
    agentTrail: { available: true },
    graph: {
      steps: [
        {
          id: "step-standards",
          title: "明确岗位审核标准",
          agentName: "OD / Claude Code",
          status: "done",
        },
        { id: "step-review", title: "初审简历", agentName: "招聘 / Codex", status: "done" },
        { id: "step-summary", title: "汇总待核事项", agentName: "招聘 / Codex", status: "done" },
        { id: "step-recheck", title: "复核审核建议", agentName: "HR 总管", status: "done" },
      ],
      edges: [
        { from: "step-standards", to: "step-review" },
        { from: "step-standards", to: "step-summary" },
        { from: "step-review", to: "step-recheck" },
        { from: "step-summary", to: "step-recheck" },
      ],
    },
    activities: [
      {
        id: "a1",
        kind: "step",
        title: "完成明确岗位审核标准",
        time: "16:24",
        actor: "OD / Claude Code",
        stepId: "step-standards",
      },
      {
        id: "a2",
        kind: "step",
        title: "完成初审简历",
        time: "16:24",
        actor: "招聘 / Codex",
        stepId: "step-review",
      },
      {
        id: "a3",
        kind: "step",
        title: "完成汇总待核事项",
        time: "16:24",
        actor: "招聘 / Codex",
        stepId: "step-summary",
      },
      {
        id: "a4",
        kind: "review",
        title: "复核通过",
        time: "16:24",
        actor: "HR 总管",
        stepId: "step-recheck",
      },
      { id: "a5", kind: "dispatch", title: "派发任务", time: "16:24", actor: "你", stepId: null },
      {
        id: "a6",
        kind: "conversation",
        title: "任务已完成",
        time: "16:24",
        actor: "工作台",
        stepId: null,
      },
    ],
    conversations: [
      {
        scope: { taskId: "t25", kind: "project-assistant", stepId: null },
        label: "项目助手 · #025",
      },
      {
        scope: { taskId: "t25", kind: "step-thread", stepId: "step-review" },
        label: "步骤线程 · 初审简历",
      },
      { scope: { taskId: "t25", kind: "observer", stepId: null }, label: "只读观察" },
    ],
  };

  const t24: TaskDetailSnapshot = {
    taskId: "t24",
    title: "产品经理简历审核 #024",
    status: "awaiting-review",
    workflowVersion: "简历审核 v1",
    completedSteps: 2,
    totalSteps: 4,
    agentTrail: { available: true },
    graph: {
      steps: [
        {
          id: "step-standards-24",
          title: "明确岗位审核标准",
          agentName: "OD / Claude Code",
          status: "done",
        },
        { id: "step-review-24", title: "初审简历", agentName: "招聘 / Codex", status: "done" },
        {
          id: "step-summary-24",
          title: "汇总待核事项",
          agentName: "招聘 / Codex",
          status: "running",
        },
        { id: "step-recheck-24", title: "复核审核建议", agentName: "HR 总管", status: "pending" },
      ],
      edges: [
        { from: "step-standards-24", to: "step-review-24" },
        { from: "step-standards-24", to: "step-summary-24" },
        { from: "step-review-24", to: "step-recheck-24" },
        { from: "step-summary-24", to: "step-recheck-24" },
      ],
    },
    activities: [
      {
        id: "a1-24",
        kind: "dispatch",
        title: "派发任务",
        time: "15:02",
        actor: "你",
        stepId: null,
      },
      {
        id: "a2-24",
        kind: "step",
        title: "完成明确岗位审核标准",
        time: "15:10",
        actor: "OD / Claude Code",
        stepId: "step-standards-24",
      },
      {
        id: "a3-24",
        kind: "step",
        title: "完成初审简历",
        time: "15:31",
        actor: "招聘 / Codex",
        stepId: "step-review-24",
      },
    ],
    conversations: [
      {
        scope: { taskId: "t24", kind: "project-assistant", stepId: null },
        label: "项目助手 · #024",
      },
      { scope: { taskId: "t24", kind: "observer", stepId: null }, label: "只读观察" },
    ],
  };

  const t18: TaskDetailSnapshot = {
    ...t25,
    taskId: "t18",
    title: "研发简历审核 #018",
    conversations: [
      {
        scope: { taskId: "t18", kind: "project-assistant", stepId: null },
        label: "项目助手 · #018",
      },
    ],
    activities: t25.activities.slice(0, 3).map((activity) => ({
      ...activity,
      id: `${activity.id}-18`,
      time: "11:40",
    })),
  };
  return {
    projectName,
    team,
    tasks,
    snapshots: new Map([
      ["t25", t25],
      ["t24", t24],
      ["t18", t18],
    ]),
  };
}
