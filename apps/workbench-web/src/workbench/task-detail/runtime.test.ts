import { describe, expect, it, vi } from "vite-plus/test";

import { initialTaskRuntime, reduceTaskRuntime, type TaskDetailEvent } from "./runtime";
import type { TaskDetailSnapshot } from "./domain";

function snapshot(taskId = "t25", over: Partial<TaskDetailSnapshot> = {}): TaskDetailSnapshot {
  return {
    taskId,
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
      ],
      edges: [{ from: "step-standards", to: "step-review" }],
    },
    activities: [],
    conversations: [
      { scope: { taskId, kind: "project-assistant", stepId: null }, label: "项目助手 · #025" },
    ],
    ...over,
  };
}

describe("task runtime", () => {
  it("loads a snapshot and clears the loading and transport-failure states", () => {
    let state = initialTaskRuntime("t25");
    state = reduceTaskRuntime(state, { type: "snapshot-loading" });
    expect(state.phase).toBe("loading");
    state = reduceTaskRuntime(state, { type: "snapshot-loaded", snapshot: snapshot() });
    expect(state.phase).toBe("ready");
    expect(state.snapshot?.taskId).toBe("t25");
    expect(state.transportError).toBeNull();
  });

  it("captures a transport failure with a retry path instead of losing the page", () => {
    let state = reduceTaskRuntime(initialTaskRuntime("t25"), { type: "snapshot-loading" });
    state = reduceTaskRuntime(state, { type: "transport-failed", message: "连接中断" });
    expect(state.phase).toBe("failed");
    expect(state.transportError).toBe("连接中断");
    state = reduceTaskRuntime(state, { type: "snapshot-loading" });
    state = reduceTaskRuntime(state, { type: "snapshot-loaded", snapshot: snapshot() });
    expect(state.phase).toBe("ready");
  });

  it("refetches the snapshot after a stream gap so missed events are recovered", async () => {
    const fetchSnapshot = vi.fn(async (_taskId: string) => snapshot());
    let state = initialTaskRuntime("t25");
    state = reduceTaskRuntime(state, { type: "snapshot-loaded", snapshot: snapshot() });
    const gapState = reduceTaskRuntime(state, { type: "stream-gap" });
    expect(gapState.resyncRequested).toBe(true);
    // The owner of the ports observes resyncRequested, refetches, and reports the result.
    await fetchSnapshot("t25");
    state = reduceTaskRuntime(gapState, { type: "snapshot-loaded", snapshot: snapshot() });
    expect(state.resyncRequested).toBe(false);
    expect(fetchSnapshot).toHaveBeenCalled();
  });

  it("applies live step-status and activity events to the ready snapshot", () => {
    let state = initialTaskRuntime("t25");
    state = reduceTaskRuntime(state, { type: "snapshot-loaded", snapshot: snapshot() });
    const activity = {
      id: "a9",
      kind: "step" as const,
      title: "完成初审简历",
      time: "16:25",
      actor: "招聘 / Codex",
      stepId: "step-review",
    };
    state = reduceTaskRuntime(state, {
      type: "step-status",
      taskId: "t25",
      stepId: "step-review",
      status: "running",
    });
    state = reduceTaskRuntime(state, { type: "activity-appended", taskId: "t25", activity });
    expect(state.snapshot?.graph.steps.find((s) => s.id === "step-review")?.status).toBe("running");
    expect(state.snapshot?.activities.at(-1)?.id).toBe("a9");
  });

  it("degrades to unavailable AgentTrail without affecting the task graph and review", () => {
    let state = initialTaskRuntime("t25");
    state = reduceTaskRuntime(state, { type: "snapshot-loaded", snapshot: snapshot() });
    const degraded = reduceTaskRuntime(state, {
      type: "agent-trail-unavailable",
      reason: "AgentTrail 扩展未连接",
    });
    expect(degraded.snapshot?.agentTrail).toEqual({
      available: false,
      reason: "AgentTrail 扩展未连接",
    });
    expect(degraded.snapshot?.graph.steps).toHaveLength(2);
    const recovered = reduceTaskRuntime(degraded, { type: "agent-trail-recovered" });
    expect(recovered.snapshot?.agentTrail.available).toBe(true);
  });

  it("ignores live events that belong to a different task", () => {
    let state = initialTaskRuntime("t25");
    state = reduceTaskRuntime(state, { type: "snapshot-loaded", snapshot: snapshot() });
    const foreign: TaskDetailEvent = {
      type: "step-status",
      taskId: "t24",
      stepId: "step-review",
      status: "running",
    };
    const next = reduceTaskRuntime(state, foreign);
    expect(next.snapshot?.graph.steps.find((s) => s.id === "step-review")?.status).toBe("done");
  });
});
