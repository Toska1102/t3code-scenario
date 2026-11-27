import { describe, expect, it } from "vite-plus/test";

import {
  attemptCreated,
  buildReviewTask,
  downstreamStepIds,
  invalidateApprovalsForReturn,
  isReviewReady,
} from "./workbenchReview.ts";

const resumeReviewGraph = buildReviewTask({
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

describe("review join readiness", () => {
  it("waits for every direct upstream step to succeed before opening review", () => {
    const succeeded = new Set(["criteria", "firstScreen"]);
    expect(isReviewReady(resumeReviewGraph, "secondReview", succeeded)).toBe(false);
  });

  it("opens the review once all direct upstream branches have succeeded", () => {
    const succeeded = new Set(["criteria", "firstScreen", "summarize"]);
    expect(isReviewReady(resumeReviewGraph, "secondReview", succeeded)).toBe(true);
  });

  it("does not count an upstream step twice through overlapping branches", () => {
    // firstScreen and summarize both depend on criteria; criteria alone is not enough.
    const succeeded = new Set(["criteria"]);
    expect(isReviewReady(resumeReviewGraph, "secondReview", succeeded)).toBe(false);
  });
});

describe("return impact", () => {
  it("collects only the steps that transitively depend on the returned output", () => {
    expect(downstreamStepIds(resumeReviewGraph, "firstScreen")).toEqual(["secondReview"]);
    expect(downstreamStepIds(resumeReviewGraph, "criteria").sort()).toEqual([
      "firstScreen",
      "secondReview",
      "summarize",
    ]);
  });

  it("invalidates dependent approvals but preserves independent branches", () => {
    const invalidated = invalidateApprovalsForReturn(
      resumeReviewGraph,
      "firstScreen",
      new Set(["criteria", "firstScreen", "summarize", "secondReview"]),
    );
    // firstScreen itself reruns; criteria and summarize keep their results.
    expect(invalidated.has("firstScreen")).toBe(true);
    expect(invalidated.has("secondReview")).toBe(true);
    expect(invalidated.has("criteria")).toBe(false);
    expect(invalidated.has("summarize")).toBe(false);
  });
});

describe("attempts", () => {
  it("starts the returned step's next attempt at a fresh number", () => {
    expect(attemptCreated({ attempt: 2 })).toEqual({ attempt: 3 });
  });
});
