import type { OrganizationDraft, OrgNode } from "./Organization.ts";

// 画板 01.02 样例：HR 总管 → OD/TD/C&B/SSC/ER/Culture/招聘；SSC → TA/入转调离/薪酬核算/社保公积金。
export function boardOrganization(): OrganizationDraft {
  const node = (
    id: string,
    parentIds: string[],
    name = id,
    extra: Partial<OrgNode> = {},
  ): OrgNode => ({
    id,
    name,
    type: "role",
    responsibility: "",
    assignee: null,
    parentIds,
    reviewRules: [],
    prompt: "",
    tools: [],
    tokenLimit: null,
    models: [],
    ...extra,
  });
  return {
    rootNodeId: "hr",
    nodes: [
      node("hr", [], "HR 总管"),
      node("od", ["hr"], "OD", { assignee: { kind: "agent", instanceId: "claude-1" } }),
      node("td", ["hr"], "TD"),
      node("cb", ["hr"], "C&B"),
      node("ssc", ["hr"], "SSC"),
      node("er", ["hr"], "ER"),
      node("culture", ["hr"], "Culture"),
      node("recruit", ["hr"], "招聘", { assignee: { kind: "agent", instanceId: "codex-1" } }),
      node("ta", ["ssc"], "TA"),
      node("onboard", ["ssc"], "入转调离"),
      node("payroll", ["ssc"], "薪酬核算"),
      node("benefit", ["ssc"], "社保公积金"),
    ],
  };
}
