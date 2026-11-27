import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { parseOrganizationYaml, serializeOrganizationYaml } from "./organizationYaml";
import { boardOrganization } from "../../../workbench-core/src/teams/organization/Organization.test";

describe("Organization YAML round trip (story 13)", () => {
  it("exports structure, rules and constraints with a format version", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "recruit")!.reviewRules = [
      { id: "rule-1", taskType: "简历审核", reviewerNodeId: "hr", required: true },
    ];
    org.nodes.find((n) => n.id === "od")!.tokenLimit = 8000;
    const yaml = serializeOrganizationYaml(org, {
      name: "HR 团队",
      description: "负责组织发展与人力资源运营",
    });
    expect(yaml).toContain("formatVersion: 1");
    expect(yaml).toContain("name: HR 团队");
    expect(yaml).toContain("简历审核");
    expect(yaml).toContain("tokenLimit: 8000");
  });

  it("never exports assignee bindings, credentials or device paths", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "recruit")!.assignee = { kind: "agent", instanceId: "codex-1" };
    org.nodes.find((n) => n.id === "od")!.assignee = { kind: "person", personId: "p-1" };
    const yaml = serializeOrganizationYaml(org, { name: "HR 团队", description: "" });
    expect(yaml).not.toContain("codex-1");
    expect(yaml).not.toContain("p-1");
    expect(yaml).not.toContain("assignee");
    expect(yaml).not.toContain("/Users/");
  });

  it("parses exported YAML back into an equivalent structure", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "recruit")!.parentIds = ["td", "ssc"];
    const yaml = serializeOrganizationYaml(org, {
      name: "HR 团队",
      description: "负责组织发展与人力资源运营",
    });
    const parsed = parseOrganizationYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.organization.nodes.map((n) => n.id).sort()).toEqual(
      org.nodes.map((n) => n.id).sort(),
    );
    expect(parsed.organization.rootNodeId).toBe("hr");
    const recruit = parsed.organization.nodes.find((n) => n.id === "recruit");
    expect(recruit?.parentIds.sort()).toEqual(["ssc", "td"]);
    expect(recruit?.assignee).toBeNull();
    // 导入后提示重新绑定人员或 Agent。
    expect(parsed.rebindNodeIds).toContain("recruit");
    expect(parsed.team).toEqual({ name: "HR 团队", description: "负责组织发展与人力资源运营" });
  });

  it("rejects malformed YAML and unknown format versions with located issues, keeping the caller draft intact", () => {
    expect(parseOrganizationYaml("not: [valid")).toMatchObject({ ok: false });
    const wrongVersion = serializeOrganizationYaml(boardOrganization(), {
      name: "t",
      description: "",
    }).replace("formatVersion: 1", "formatVersion: 99");
    const parsed = parseOrganizationYaml(wrongVersion);
    expect(parsed).toMatchObject({ ok: false, issues: [{ field: "formatVersion" }] });

    const dangling = stringify({
      formatVersion: 1,
      team: { name: "t", description: "" },
      rootNodeId: "hr",
      nodes: [
        { id: "hr", name: "HR 总管", type: "role", parentIds: [] },
        { id: "od", name: "OD", type: "role", parentIds: ["ghost"] },
      ],
    });
    expect(parseOrganizationYaml(dangling)).toMatchObject({
      ok: false,
      issues: [{ field: "nodes.od" }],
    });
  });

  it("rejects malformed field shapes with located issues instead of throwing", () => {
    const cases = [
      {
        team: { name: "t", description: "" },
        rootNodeId: "hr",
        nodes: [{ id: "hr", name: "R", type: "role", parentIds: [], reviewRules: "x" }],
      },
      {
        team: { name: "t", description: "" },
        rootNodeId: "hr",
        nodes: [
          {
            id: "hr",
            name: "R",
            type: "role",
            parentIds: [],
            reviewRules: [{ taskType: 123, reviewerNodeId: "hr", required: true }],
          },
        ],
      },
      {
        team: { name: "t", description: "" },
        rootNodeId: "hr",
        nodes: [{ id: "hr", name: "R", type: "role", parentIds: [], tools: "abc" }],
      },
      {
        team: { name: "t", description: "" },
        rootNodeId: "hr",
        nodes: [
          { id: "hr", name: "R", type: "role", parentIds: [] },
          { id: "hr", name: "X", type: "role", parentIds: [] },
        ],
      },
    ];
    for (const file of cases) {
      const result = parseOrganizationYaml(stringify({ formatVersion: 1, ...file }));
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.issues[0]?.field).toBeTruthy();
    }
  });

  it("round-trips nodes with multiple review rules", () => {
    const org = boardOrganization();
    org.nodes.find((n) => n.id === "recruit")!.reviewRules = [
      { id: "r1", taskType: "简历审核", reviewerNodeId: "hr", required: true },
      { id: "r2", taskType: "汇总复核", reviewerNodeId: "ssc", required: false },
    ];
    const parsed = parseOrganizationYaml(
      serializeOrganizationYaml(org, { name: "t", description: "" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.organization.nodes.find((n) => n.id === "recruit")?.reviewRules.map((r) => r.id),
    ).toEqual(["r1", "r2"]);
  });
});
