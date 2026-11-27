import { describe, expect, it } from "vite-plus/test";

import {
  affectedDownstream,
  layoutDiagramSteps,
  statusLabel,
  statusTone,
} from "./workbenchReviewUi.logic";

const steps = [
  { stepId: "criteria", dependsOn: [], executor: "OD / Claude Code", status: "succeeded" as const },
  {
    stepId: "firstScreen",
    dependsOn: ["criteria"],
    executor: "招聘 / Codex",
    status: "succeeded" as const,
  },
  {
    stepId: "summarize",
    dependsOn: ["criteria"],
    executor: "招聘 / Codex",
    status: "waitingReview" as const,
  },
  {
    stepId: "secondReview",
    dependsOn: ["firstScreen", "summarize"],
    executor: "HR 总管",
    status: "pending" as const,
  },
];

describe("diagram layout", () => {
  it("places joined steps after their deepest upstream", () => {
    const nodes = layoutDiagramSteps(steps);
    const depthOf = (id: string) => nodes.find((node) => node.stepId === id)!.depth;
    expect(depthOf("criteria")).toBe(0);
    expect(depthOf("firstScreen")).toBe(1);
    expect(depthOf("secondReview")).toBe(2);
  });

  it("assigns distinct lanes to parallel siblings", () => {
    const nodes = layoutDiagramSteps(steps);
    const lanes = nodes.filter((node) => node.depth === 1).map((node) => node.lane);
    expect(new Set(lanes).size).toBe(2);
  });
});

describe("status presentation", () => {
  it("labels and tones every status", () => {
    expect(statusLabel("waitingReview")).toBe("待评审");
    expect(statusTone("waitingReview")).toBe("attention");
    expect(statusTone("approved")).toBe("good");
    expect(statusTone("returned")).toBe("bad");
  });
});

describe("return impact preview", () => {
  it("lists downstream steps the reviewer will invalidate", () => {
    expect(affectedDownstream(steps, "criteria").sort()).toEqual([
      "firstScreen",
      "secondReview",
      "summarize",
    ]);
    expect(affectedDownstream(steps, "firstScreen")).toEqual(["secondReview"]);
  });
});
