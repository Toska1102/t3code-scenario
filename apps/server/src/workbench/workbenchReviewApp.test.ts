import { describe, expect, it } from "vite-plus/test";

import { createWorkbenchReviewService } from "../../../../packages/workbench-core/src/tasks/workbenchReviewService.ts";
import { createWorkbenchReviewMemoryStore } from "../../../../packages/workbench-core/src/tasks/workbenchReviewMemoryStore.ts";

import { createWorkbenchReviewApp } from "./workbenchReviewApp.ts";

function createApp() {
  const service = createWorkbenchReviewService({ store: createWorkbenchReviewMemoryStore() });
  const app = createWorkbenchReviewApp({ service });
  app.service.createTask({
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
  app.service.completeStep({ taskId: "task-025", stepId: "criteria" });
  app.service.completeStep({ taskId: "task-025", stepId: "firstScreen" });
  app.service.completeStep({ taskId: "task-025", stepId: "summarize" });
  return app;
}

describe("workbench review app port", () => {
  it("rejects unauthenticated requests", () => {
    const app = createApp();
    const response = app.handleQueue({ authenticatedUserId: null });
    expect(response).toMatchObject({ status: 401, body: { error: { code: "unauthenticated" } } });
  });

  it("scopes the visible pending queue to the authenticated reviewer (D04)", () => {
    const app = createApp();
    const response = app.handleQueue({ authenticatedUserId: "user-hr" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reviews: [{ taskId: "task-025", stepId: "secondReview", assignedReviewerId: "user-hr" }],
    });
    const other = app.handleQueue({ authenticatedUserId: "user-other" });
    expect(other.body).toMatchObject({ reviews: [] });
  });

  it("takes the actor from authentication, never from the payload (D03)", () => {
    const app = createApp();
    const response = app.handleDecide({
      authenticatedUserId: "user-deputy",
      // A client claiming someone else's identity must not change who acted.
      body: {
        taskId: "task-025",
        stepId: "secondReview",
        attempt: 1,
        decision: "approve",
        actorId: "user-hr",
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      review: { assignedReviewerId: "user-hr", decidedByActorId: "user-deputy" },
    });
  });

  it("maps a stale duplicate decision to a conflict error", () => {
    const app = createApp();
    app.handleDecide({
      authenticatedUserId: "user-hr",
      body: { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
    });
    const response = app.handleDecide({
      authenticatedUserId: "user-hr",
      body: { taskId: "task-025", stepId: "secondReview", attempt: 1, decision: "approve" },
    });
    expect(response).toMatchObject({
      status: 409,
      body: { error: { code: "review_not_open" } },
    });
  });

  it("maps validation failures to meaningful error codes", () => {
    const app = createApp();
    expect(
      app.handleDecide({
        authenticatedUserId: "user-hr",
        body: {
          taskId: "task-025",
          stepId: "secondReview",
          attempt: 1,
          decision: "return",
          reason: "  ",
          returnToStepId: "firstScreen",
        },
      }),
    ).toMatchObject({ status: 422, body: { error: { code: "blank_reason" } } });
    expect(
      app.handleDecide({
        authenticatedUserId: "user-hr",
        body: {
          taskId: "task-025",
          stepId: "secondReview",
          attempt: 1,
          decision: "return",
          reason: "标准不对",
          returnToStepId: "not-a-step",
        },
      }),
    ).toMatchObject({ status: 422, body: { error: { code: "invalid_return_target" } } });
    expect(
      app.handleDecide({
        authenticatedUserId: "user-hr",
        body: { taskId: "task-404", stepId: "secondReview", attempt: 1, decision: "approve" },
      }),
    ).toMatchObject({ status: 404, body: { error: { code: "unknown_task" } } });
  });

  it("rejects malformed decision payloads", () => {
    const app = createApp();
    expect(
      app.handleDecide({ authenticatedUserId: "user-hr", body: { decision: "approve" } }),
    ).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });
  });
});
