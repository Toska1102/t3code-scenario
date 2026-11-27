import { describe, expect, it } from "vite-plus/test";
import { candidatePool, coveragePreview } from "./members.ts";
import type {
  TeamGraphNode,
  TeamGraphSnapshot,
} from "../../../workbench-contracts/src/workflow/types.ts";

/** 招聘运营 org: HR 总管 (root) with two parents-capable children OD / 招聘 (story 10). */
function node(
  id: string,
  parents: string[],
  overrides: Partial<TeamGraphNode> = {},
): TeamGraphNode {
  return {
    id,
    name: id,
    parents,
    binding: { kind: "agent", instanceId: `${id}-agent`, agentName: "codex" },
    tools: "读写文件",
    tokens: 8000,
    model: "Claude Sonnet",
    reviewRules: [],
    ...overrides,
  };
}

const graph: TeamGraphSnapshot = {
  teamId: "team-1",
  teamName: "招聘运营",
  revision: 7,
  nodes: [
    node("hr", [], {
      name: "HR 总管",
      binding: { kind: "human", personName: "王总" },
      tools: "读取文件",
      model: "Claude Sonnet",
    }),
    node("od", ["hr"], { name: "OD" }),
    node("recruit", ["hr"], { name: "招聘" }),
    // Multi-parent: TD reports to both OD and 招聘 (adjacent layer, no cycle).
    node("td", ["od", "recruit"], { name: "TD" }),
  ],
};

describe("member candidate pool", () => {
  it("adds all ancestor paths up to the root once, keeping dedupe across multi-parent graphs", () => {
    const pool = candidatePool(graph, ["td"]);
    expect(pool.map((entry) => entry.node.id)).toEqual(["td", "od", "recruit", "hr"]);
    expect(pool.filter((entry) => entry.autoIncluded).map((entry) => entry.node.id)).toEqual([
      "od",
      "recruit",
      "hr",
    ]);
    expect(pool.filter((entry) => !entry.autoIncluded).map((entry) => entry.node.id)).toEqual([
      "td",
    ]);
  });

  it("shows each duplicate ancestor once when several selected members share it", () => {
    const pool = candidatePool(graph, ["od", "recruit"]);
    expect(pool.filter((entry) => entry.node.id === "hr")).toHaveLength(1);
    expect(pool.map((entry) => entry.node.id)).toEqual(["od", "recruit", "hr"]);
  });

  it("ignores unknown member ids and tolerates a missing parent without looping", () => {
    const pool = candidatePool(graph, ["od", "ghost"]);
    expect(pool.map((entry) => entry.node.id)).toEqual(["od", "hr"]);
  });

  it("previews coverage: member match and review basis for regeneration (story 23)", () => {
    const withRule = {
      ...graph,
      nodes: graph.nodes.map((candidate) =>
        candidate.id === "hr"
          ? {
              ...candidate,
              reviewRules: [{ reviewerNodeId: "hr", taskTypeKeywords: ["简历审核"] }],
            }
          : candidate,
      ),
    };
    const coverage = coveragePreview(withRule, ["od", "recruit"], "简历审核");
    expect(coverage.candidateIds).toEqual(["od", "recruit", "hr"]);
    expect(coverage.autoIncludedIds).toEqual(["hr"]);
    expect(coverage.appliedReviewRules).toEqual([{ ownerNodeId: "hr", reviewerNodeId: "hr" }]);
  });
});
