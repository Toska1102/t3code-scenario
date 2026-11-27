import { beforeEach, describe, expect, it } from "vite-plus/test";

import { createWorkbenchReviewService } from "./workbenchReviewService.ts";
import { createWorkbenchReviewMemoryStore } from "./workbenchReviewMemoryStore.ts";
import type { WorkbenchReviewError } from "./workbenchReviewService.ts";

/** 04-01 task #025 shape: parallel branches joined by a manual review step. */
function createService() {
  const store = createWorkbenchReviewMemoryStore();
  const service = createWorkbenchReviewService({ store });
  service.createTask({
    taskId: "task-025",
    steps: [
      { stepId: "criteria", dependsOn: [], executor: "OD / Claude Code" },
      { stepId: "firstScreen", dependsOn: ["criteria"], executor: "招聘 / Codex" },
      { stepId: "summarize", dependsOn: ["criteria"], executor: "招聘 / Codex" },
      {
        stepId: "secondReview",
        dependsOn: ["firstScreen", "summarize"],
        executor: "HR 总管",
        reviewerId: "user-hr",
      },
    ],
  });
  return { store, service };
}

function runToReview(service: ReturnType<typeof createService>["service"]) {
  service.completeStep({ taskId: "task-025", stepId: "criteria" });
  service.completeStep({ taskId: "task-025", stepId: "firstScreen" });
  service.completeStep({ taskId: "task-025", stepId: "summarize" });
}

function rerunToReview(service: ReturnType<typeof createService>["service"]) {
  service.completeStep({ taskId: "task-025", stepId: "criteria" });
  service.completeStep({ taskId: "task-025", stepId: "firstScreen" });
  service.completeStep({ taskId: "task-025", stepId: "summarize" });
}

function errorOf(action: () => unknown): WorkbenchReviewError {
  try {
    action();
  } catch (error) {
    return error as WorkbenchReviewError;
  }
  throw new Error("Expected the action to fail");
}

describe("pending queue ownership", () => {
  let service: ReturnType<typeof createService>["service"];
  beforeEach(() => {
    ({ service } = createService());
    runToReview(service);
  });

  it("counts the pending review for the assigned reviewer only (D04)", () => {
    expect(service.listOpenReviews({ reviewerId: "user-hr" }).map((r) => r.stepId)).toEqual([
      "secondReview",
    ]);
    expect(service.listOpenReviews({ reviewerId: "user-other" })).toEqual([]);
  });

  it("shows assigned reviewer and output attempt separately in the queue", () => {
    const [entry] = service.listOpenReviews({ reviewerId: "user-hr" });
    expect(entry).toMatchObject({
      taskId: "task-025",
      stepId: "secondReview",
      attempt: 1,
      assignedReviewerId: "user-hr",
    });
  });
});

describe("review decision", () => {
  let service: ReturnType<typeof createService>["service"];
  beforeEach(() => {
    ({ service } = createService());
    runToReview(service);
  });

  it("records the assigned reviewer and the real acting admin separately (D03)", () => {
    service.decideReview(
      { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
      { actorId: "user-deputy" },
    );
    const record = service
      .getReviewHistory({ taskId: "task-025", stepId: "secondReview" })
      .find((r) => r.attempt === 1);
    expect(record).toMatchObject({
      assignedReviewerId: "user-hr",
      decidedByActorId: "user-deputy",
      status: "approved",
    });
    // Ownership stays with the assigned reviewer; the deputy is only audited.
    expect(service.listOpenReviews({ reviewerId: "user-deputy" })).toEqual([]);
  });

  it("rejects a second decision on the same review without producing a new result", () => {
    service.decideReview(
      { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
      { actorId: "user-hr" },
    );
    const error = errorOf(() =>
      service.decideReview(
        {
          taskId: "task-025",
          stepId: "secondReview",
          attempt: 1,
          decision: "return",
          reason: "late",
          returnToStepId: "firstScreen",
        },
        { actorId: "user-hr" },
      ),
    );
    expect(error.code).toBe("review_not_open");
  });

  it("rejects a decision carrying an outdated attempt as stale", () => {
    service.decideReview(
      {
        taskId: "task-025",
        stepId: "secondReview",
        attempt: 1,
        decision: "return",
        reason: "漏了必答项",
        returnToStepId: "firstScreen",
      },
      { actorId: "user-hr" },
    );
    // Attempt 1 is finished; a decision submitted against it is stale.
    const error = errorOf(() =>
      service.decideReview(
        { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
        { actorId: "user-hr" },
      ),
    );
    expect(error.code).toBe("review_not_open");
  });

  it("fails with a meaningful error for an unknown task or step", () => {
    expect(
      errorOf(() =>
        service.decideReview(
          { taskId: "task-404", stepId: "secondReview", attempt: 1, decision: "approve" },
          { actorId: "user-hr" },
        ),
      ).code,
    ).toBe("unknown_task");
    expect(
      errorOf(() =>
        service.decideReview(
          { taskId: "task-025", stepId: "nope", attempt: 1, decision: "approve" },
          { actorId: "user-hr" },
        ),
      ).code,
    ).toBe("unknown_step");
  });
});

describe("return for rework", () => {
  let service: ReturnType<typeof createService>["service"];
  beforeEach(() => {
    ({ service } = createService());
    runToReview(service);
  });

  it("requires a nonblank reason", () => {
    for (const reason of ["", "   "]) {
      const error = errorOf(() =>
        service.decideReview(
          {
            taskId: "task-025",
            stepId: "secondReview",
            attempt: 1,
            decision: "return",
            reason,
            returnToStepId: "firstScreen",
          },
          { actorId: "user-hr" },
        ),
      );
      expect(error.code).toBe("blank_reason");
    }
  });

  it("requires a valid rework target within the task", () => {
    expect(
      errorOf(() =>
        service.decideReview(
          {
            taskId: "task-025",
            stepId: "secondReview",
            attempt: 1,
            decision: "return",
            reason: "标准理解错了",
            returnToStepId: "criteria-missing",
          },
          { actorId: "user-hr" },
        ),
      ).code,
    ).toBe("invalid_return_target");
  });

  it("starts an independent attempt and keeps history on return", () => {
    service.decideReview(
      {
        taskId: "task-025",
        stepId: "secondReview",
        attempt: 1,
        decision: "return",
        reason: "漏了必答项",
        returnToStepId: "firstScreen",
      },
      { actorId: "user-hr" },
    );
    const task = service.getTask("task-025");
    expect(task?.stepRuns.firstScreen).toMatchObject({ attempt: 2, status: "pending" });
    // Historical opinions survive the return (R10).
    expect(service.getReviewHistory({ taskId: "task-025", stepId: "secondReview" })).toHaveLength(
      1,
    );
    // The returned review must be redone for the new attempt.
    expect(
      service.listOpenReviews({}).some((r) => r.stepId === "secondReview" && r.attempt === 1),
    ).toBe(false);
  });

  it("invalidates outputs that depend on the reworked step, preserving independent ones (A04)", () => {
    service.decideReview(
      {
        taskId: "task-025",
        stepId: "secondReview",
        attempt: 1,
        decision: "return",
        reason: "标准变了",
        returnToStepId: "criteria",
      },
      { actorId: "user-hr" },
    );
    const task = service.getTask("task-025");
    // criteria reruns; both branches consuming its output are invalidated too.
    expect(task?.stepRuns.criteria).toMatchObject({ attempt: 2, status: "pending" });
    expect(task?.stepRuns.firstScreen).toMatchObject({ attempt: 2, status: "pending" });
    expect(task?.stepRuns.summarize).toMatchObject({ attempt: 2, status: "pending" });
    // History is preserved.
    expect(
      service
        .getReviewHistory({ taskId: "task-025", stepId: "secondReview" })
        .map((r) => r.attempt),
    ).toEqual([1]);
  });
});

describe("join and unlock", () => {
  it("does not open the review until both parallel branches succeeded (R06)", () => {
    const { service } = createService();
    service.completeStep({ taskId: "task-025", stepId: "criteria" });
    service.completeStep({ taskId: "task-025", stepId: "firstScreen" });
    expect(service.listOpenReviews({ reviewerId: "user-hr" })).toEqual([]);
    const error = errorOf(() =>
      service.decideReview(
        { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
        { actorId: "user-hr" },
      ),
    );
    expect(error.code).toBe("review_not_open");
  });

  it("marks the reviewed step approved after approval (D05)", () => {
    const { service } = createService();
    runToReview(service);
    service.decideReview(
      { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
      { actorId: "user-hr" },
    );
    const task = service.getTask("task-025");
    expect(task?.stepRuns.secondReview).toMatchObject({ attempt: 1, status: "approved" });
  });

  it("requires a fresh approval for the new attempt after rework (D05)", () => {
    const { service } = createService();
    runToReview(service);
    service.decideReview(
      {
        taskId: "task-025",
        stepId: "secondReview",
        attempt: 1,
        decision: "return",
        reason: "补一次必审",
        returnToStepId: "firstScreen",
      },
      { actorId: "user-hr" },
    );
    rerunToReview(service);
    // Attempt 1's approval does not carry over: the review opens again on the new output,
    // and the step is back to waiting rather than approved.
    const open = service.listOpenReviews({ reviewerId: "user-hr" });
    expect(open.map((r) => r.attempt)).toEqual([2]);
    expect(service.getTask("task-025")?.stepRuns.secondReview).toMatchObject({
      attempt: 2,
      status: "waitingReview",
    });
  });
});
