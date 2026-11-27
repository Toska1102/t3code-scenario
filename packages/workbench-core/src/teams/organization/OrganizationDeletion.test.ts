import { describe, expect, it } from "vitest";
import {
  descendantsOf,
  previewNodeDeletion,
  removeNodes,
  validateOrganization,
} from "./Organization";
import { boardOrganization } from "./Organization.test";

describe("Node deletion (story 9)", () => {
  it("refuses to delete the root", () => {
    const org = boardOrganization();
    expect(previewNodeDeletion(org, "hr")).toMatchObject({
      ok: false,
      code: "root_not_deletable",
    });
  });

  it("previews descendants, orphaned children and affected review rules", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "recruit")!.reviewRules = [
      { id: "rule-1", taskType: "简历审核", reviewerNodeId: "hr", required: true },
    ];
    const result = previewNodeDeletion(org, "ssc");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.descendants.map((d) => d.id)).toEqual([
      "ta",
      "onboard",
      "payroll",
      "benefit",
    ]);
    expect(result.preview.orphanIds).toEqual(["ta", "onboard", "payroll", "benefit"]);
    expect(result.preview.removedReviewRules).toEqual([]);
  });

  it("collects review rules from the deleted node and its descendants", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "ssc")!.reviewRules = [
      { id: "rule-s", taskType: "薪酬复核", reviewerNodeId: "hr", required: false },
    ];
    org.nodes.find((n) => n.id === "ta")!.reviewRules = [
      { id: "rule-t", taskType: "简历初审", reviewerNodeId: "ssc", required: true },
    ];
    const result = previewNodeDeletion(org, "ssc");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.removedReviewRules.map((r) => r.ruleId)).toEqual(["rule-s", "rule-t"]);
  });

  it("keeping an orphan child yields an invalid organization; re-homing it to an adjacent survivor is valid", () => {
    const org = boardOrganization();
    // 删除 SSC、保留 TA（不改挂）→ TA 失去上级，阻止保存。
    const keptOrphan = removeNodes(org, ["ssc"]);
    expect(validateOrganization(keptOrphan).map((i) => i.code)).toContain("missing_parent");

    // 用户显式改挂 TA 到仍存留的相邻层节点 OD，其余下属确认一并删除。
    const rehomedOrg = boardOrganization();
    rehomedOrg.nodes.find((n) => n.id === "ta")!.parentIds = ["od"];
    const withoutSsc = removeNodes(rehomedOrg, ["ssc", "onboard", "payroll", "benefit"]);
    expect(validateOrganization(withoutSsc)).toEqual([]);
  });

  it("flags surviving nodes whose review rules point at the deleted node and strips them on removal", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "od")!.reviewRules = [
      { id: "rule-od", taskType: "标准复核", reviewerNodeId: "ssc", required: true },
    ];
    const result = previewNodeDeletion(org, "ssc");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.danglingReviewRules).toEqual([
      { nodeId: "od", ruleId: "rule-od", taskType: "标准复核" },
    ]);
    const next = removeNodes(org, ["ssc"]);
    expect(next.nodes.find((n) => n.id === "od")!.reviewRules).toEqual([]);
  });

  it("cascade removal takes the confirmed descendants with the node", () => {
    const org = boardOrganization();
    const cascadeIds = ["ssc", ...descendantsOf(org, "ssc").map((d) => d.id)];
    const next = removeNodes(org, cascadeIds);
    const ids = next.nodes.map((n) => n.id);
    expect(ids).not.toContain("ssc");
    expect(ids).not.toContain("ta");
    expect(ids).not.toContain("benefit");
    expect(ids).toContain("recruit");
  });
});
