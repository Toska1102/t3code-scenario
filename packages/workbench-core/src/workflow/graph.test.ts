import { describe, expect, it } from "vite-plus/test";
import {
  autoLayout,
  canAddEdge,
  deleteStepImpact,
  findGraphProblems,
  removeStep,
  withEdge,
  withoutEdges,
} from "./graph.ts";
import type { WorkflowStep } from "../../../workbench-contracts/src/workflow/types.ts";

function step(id: string, dependsOn: string[] = [], inputStepRefs: string[] = []): WorkflowStep {
  return {
    id,
    title: `步骤 ${id}`,
    ownerId: "od",
    mode: "execution",
    dependsOn,
    position: { x: 0, y: 0 },
    config: {
      prompt: "",
      inputRefs: inputStepRefs.map((stepId) => ({ kind: "step" as const, stepId })),
      outputKey: `${id}-out`,
      outputLabel: `${id} 输出`,
      tools: "读取文件",
      tokens: 6000,
      model: "Claude Sonnet",
    },
  };
}

describe("workflow dependency graph", () => {
  it("reports cycles, dangling dependencies and duplicate edges as targeted problems", () => {
    const problems = findGraphProblems([
      step("a", ["b"]),
      step("b", ["a"]),
      step("c", ["missing"]),
      step("d", ["c", "c"]),
    ]);
    expect(problems.map((problem) => problem.code).sort()).toEqual([
      "graph.cycle",
      "graph.danglingDependency",
      "graph.duplicateEdge",
    ]);
    expect(problems.find((problem) => problem.code === "graph.cycle")?.target.id).toBe("a");
  });

  it("rejects self edges, duplicate edges and edges that would create a cycle", () => {
    const steps = [step("a"), step("b", ["a"])];
    expect(canAddEdge(steps, "a", "a")?.code).toBe("graph.selfEdge");
    expect(canAddEdge(steps, "a", "b")?.code).toBe("graph.duplicateEdge");
    expect(canAddEdge(steps, "b", "a")?.code).toBe("graph.cycle");
    expect(canAddEdge(steps, "a", step("c") ? "c" : "c")).toBeNull();
  });

  it("adds an edge as a dependency of the target step only", () => {
    const steps = [step("a"), step("b")];
    const next = withEdge(steps, "a", "b");
    expect(next.find((s) => s.id === "b")?.dependsOn).toEqual(["a"]);
    expect(next.find((s) => s.id === "a")?.dependsOn).toEqual([]);
  });

  it("removes exactly the selected edges", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["a"])];
    const next = withoutEdges(steps, [{ from: "a", to: "b" }]);
    expect(next.find((s) => s.id === "b")?.dependsOn).toEqual([]);
    expect(next.find((s) => s.id === "c")?.dependsOn).toEqual(["a"]);
  });

  it("previews the downstream steps and inputs affected by deleting a step", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"], ["b"]), step("d")];
    const impact = deleteStepImpact(steps, "a");
    expect(impact.downstreamStepTitles).toEqual(["步骤 b", "步骤 c"]);
    expect(impact.directDependentTitles).toEqual(["步骤 b"]);
  });

  it("deletes a step and cleans dependencies and step input references", () => {
    const steps = [step("a"), step("b", ["a"], ["a"]), step("c", ["b"])];
    const next = removeStep(steps, "a");
    expect(next.map((s) => s.id)).toEqual(["b", "c"]);
    expect(next.find((s) => s.id === "b")?.dependsOn).toEqual([]);
    expect(next.find((s) => s.id === "b")?.config.inputRefs).toEqual([]);
    expect(next.find((s) => s.id === "c")?.dependsOn).toEqual(["b"]);
  });

  it("auto-layout orders steps by dependency depth without changing the graph", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["a"]), step("d", ["b", "c"])];
    const laidOut = autoLayout(steps);
    expect(laidOut.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(laidOut.find((s) => s.id === "b")!.position.x).toBe(
      laidOut.find((s) => s.id === "c")!.position.x,
    );
    expect(laidOut.find((s) => s.id === "b")!.position.x).toBeGreaterThan(
      laidOut.find((s) => s.id === "a")!.position.x,
    );
    expect(laidOut.find((s) => s.id === "b")!.position.y).not.toBe(
      laidOut.find((s) => s.id === "c")!.position.y,
    );
    expect(laidOut.find((s) => s.id === "d")!.position.x).toBeGreaterThan(
      laidOut.find((s) => s.id === "b")!.position.x,
    );
  });
});
