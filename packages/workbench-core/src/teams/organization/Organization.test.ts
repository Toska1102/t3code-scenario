import { describe, expect, it } from "vite-plus/test";
import { isOrganizationValid, organizationLayers, validateOrganization } from "./Organization.ts";

import { boardOrganization } from "./organization.fixture.ts";

describe("Organization domain", () => {
  it("accepts the board organization with adjacent multi-parent reporting and derives three layers", () => {
    const org = boardOrganization();
    // 招聘 同时汇报给 TD 和 SSC（同为相邻第二层的多上级，故事 10）。
    org.nodes.find((n) => n.id === "recruit")!.parentIds = ["td", "ssc"];

    expect(validateOrganization(org)).toEqual([]);
    expect(isOrganizationValid(org)).toBe(true);
    expect(organizationLayers(org).get("hr")).toBe(1);
    expect(organizationLayers(org).get("ssc")).toBe(2);
    expect(organizationLayers(org).get("ta")).toBe(3);
  });

  it("locates a cross-layer parent edge (a second parent two layers up)", () => {
    const org = boardOrganization();
    // TA 保留 SSC 上级（第三层），再挂 HR 总管构成跨层边。
    org.nodes.find((n) => n.id === "ta")!.parentIds = ["ssc", "hr"];
    const issues = validateOrganization(org);
    expect(issues.map((i) => i.code)).toContain("cross_layer_parent");
    expect(issues.find((i) => i.code === "cross_layer_parent")).toMatchObject({
      nodeId: "ta",
      parentId: "hr",
    });
    expect(isOrganizationValid(org)).toBe(false);
  });

  it("rejects duplicate, self and dangling parent references with located issues", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "od")!.parentIds = ["hr", "hr"];
    org.nodes.find((n) => n.id === "td")!.parentIds = ["td"];
    org.nodes.find((n) => n.id === "er")!.parentIds = ["ghost"];
    const codes = validateOrganization(org);
    expect(codes.find((i) => i.nodeId === "od" && i.parentId === "hr")?.code).toBe(
      "duplicate_parent",
    );
    expect(codes.find((i) => i.nodeId === "td")?.code).toBe("self_parent");
    expect(codes.find((i) => i.nodeId === "er" && i.parentId === "ghost")?.code).toBe(
      "dangling_parent",
    );
  });

  it("rejects cycles across multi-parent edges and a second root", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "ssc")!.parentIds = ["ta"];
    org.nodes.find((n) => n.id === "ta")!.parentIds = ["ssc"];
    expect(validateOrganization(org).map((i) => i.code)).toContain("cycle");

    const twoRoots = boardOrganization();
    twoRoots.nodes.find((n) => n.id === "od")!.parentIds = [];
    const rootIssues = validateOrganization(twoRoots);
    expect(rootIssues.map((i) => i.code)).toContain("missing_parent");
  });

  it("rejects duplicate node ids", () => {
    const org = boardOrganization();
    org.nodes.push({ ...org.nodes[1]!, id: "hr" });
    expect(validateOrganization(org).map((i) => i.code)).toContain("duplicate_node_id");
  });

  it("requires node names and a positive-integer token limit", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "od")!.name = "   ";
    org.nodes.find((n) => n.id === "ssc")!.tokenLimit = 0;
    const issues = validateOrganization(org);
    expect(issues.find((i) => i.nodeId === "od")?.code).toBe("name_required");
    expect(issues.find((i) => i.nodeId === "ssc")?.code).toBe("token_limit_invalid");
  });

  it("rejects review rules pointing at missing reviewers or blank task types", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "recruit")!.reviewRules = [
      { id: "r1", taskType: "", reviewerNodeId: "hr", required: true },
      { id: "r2", taskType: "简历审核", reviewerNodeId: "ghost", required: false },
    ];
    const issues = validateOrganization(org);
    expect(issues.filter((i) => i.code === "invalid_review_rule")).toHaveLength(2);
  });
});
