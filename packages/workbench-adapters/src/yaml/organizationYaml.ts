// 团队组织 YAML 适配器：导出带格式版本的结构、规则与约束；
// 导入校验格式版本、节点、汇报与评审引用。凭据、设备实例私有绑定
// 与设备路径不随文件导出（故事 13），导入后节点一律未绑定。
import { parse, stringify } from "yaml";
import type {
  OrganizationDraft,
  OrgNode,
  OrgNodeType,
  ReviewRule,
} from "../../../workbench-core/src/teams/organization/Organization.ts";
import { validateOrganization } from "../../../workbench-core/src/teams/organization/Organization.ts";
import type { TeamInfo } from "../../../workbench-core/src/teams/organization/SaveOrganization.ts";

export const ORGANIZATION_YAML_FORMAT_VERSION = 1;

interface OrganizationYamlFile {
  formatVersion: number;
  team: TeamInfo;
  rootNodeId: string;
  nodes: Array<{
    id: string;
    name: string;
    type: OrgNodeType;
    responsibility?: string;
    parentIds: string[];
    reviewRules?: Array<{
      id: string;
      taskType: string;
      reviewerNodeId: string;
      required: boolean;
    }>;
    prompt?: string;
    tools?: string[];
    tokenLimit?: number | null;
    models?: string[];
  }>;
}

export function serializeOrganizationYaml(org: OrganizationDraft, team: TeamInfo): string {
  const file: OrganizationYamlFile = {
    formatVersion: ORGANIZATION_YAML_FORMAT_VERSION,
    team,
    rootNodeId: org.rootNodeId,
    nodes: org.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      responsibility: n.responsibility,
      parentIds: [...n.parentIds],
      reviewRules: n.reviewRules.map((r) => ({ ...r })),
      prompt: n.prompt,
      tools: [...n.tools],
      tokenLimit: n.tokenLimit,
      models: [...n.models],
    })),
  };
  return stringify(file);
}

export type ParseOrganizationYamlResult =
  | {
      ok: true;
      organization: OrganizationDraft;
      team: TeamInfo;
      /** 需要重新绑定人员或 Agent 的节点。 */ rebindNodeIds: string[];
    }
  | { ok: false; issues: Array<{ field: string; message: string }> };

function isOrgNodeFile(value: unknown): value is OrganizationYamlFile["nodes"][number] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (v.type === "role" || v.type === "capability") &&
    Array.isArray(v.parentIds) &&
    v.parentIds.every((p) => typeof p === "string") &&
    isStringList(v.tools) &&
    isStringList(v.models) &&
    isReviewRuleList(v.reviewRules) &&
    (v.tokenLimit === undefined || v.tokenLimit === null || typeof v.tokenLimit === "number")
  );
}

function isStringList(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((t) => typeof t === "string"));
}

function isReviewRuleList(
  value: unknown,
): value is NonNullable<OrganizationYamlFile["nodes"][number]["reviewRules"]> | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every((r) => {
        if (typeof r !== "object" || r === null) return false;
        const rule = r as Record<string, unknown>;
        return (
          typeof rule.id === "string" &&
          typeof rule.taskType === "string" &&
          typeof rule.reviewerNodeId === "string" &&
          typeof rule.required === "boolean"
        );
      }))
  );
}

export function parseOrganizationYaml(text: string): ParseOrganizationYamlResult {
  let file: unknown;
  try {
    file = parse(text);
  } catch (error) {
    return { ok: false, issues: [{ field: "yaml", message: `YAML 解析失败：${String(error)}` }] };
  }
  if (typeof file !== "object" || file === null) {
    return { ok: false, issues: [{ field: "yaml", message: "YAML 顶层必须是映射" }] };
  }
  const f = file as Record<string, unknown>;
  if (f.formatVersion !== ORGANIZATION_YAML_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [{ field: "formatVersion", message: `不支持的格式版本：${String(f.formatVersion)}` }],
    };
  }
  const teamField = f.team as Record<string, unknown> | undefined;
  if (
    typeof teamField?.name !== "string" ||
    (teamField.description !== undefined && typeof teamField.description !== "string")
  ) {
    return { ok: false, issues: [{ field: "team", message: "缺少团队名称" }] };
  }
  if (
    typeof f.rootNodeId !== "string" ||
    !Array.isArray(f.nodes) ||
    !f.nodes.every(isOrgNodeFile)
  ) {
    return { ok: false, issues: [{ field: "nodes", message: "节点列表格式不正确" }] };
  }
  const nodes: OrgNode[] = f.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    responsibility: n.responsibility ?? "",
    assignee: null,
    parentIds: [...n.parentIds],
    reviewRules: (n.reviewRules ?? []).map((r): ReviewRule => ({
      id: r.id,
      taskType: r.taskType,
      reviewerNodeId: r.reviewerNodeId,
      required: r.required,
    })),
    prompt: n.prompt ?? "",
    tools: [...(n.tools ?? [])],
    tokenLimit: n.tokenLimit ?? null,
    models: [...(n.models ?? [])],
  }));
  const organization: OrganizationDraft = { rootNodeId: f.rootNodeId, nodes };
  const domainIssues = validateOrganization(organization);
  if (domainIssues.length > 0) {
    return {
      ok: false,
      issues: domainIssues.map((i) => ({
        field: i.nodeId ? `nodes.${i.nodeId}` : "nodes",
        message: i.message,
      })),
    };
  }
  const team: TeamInfo = { name: teamField.name, description: teamField.description ?? "" };
  return { ok: true, organization, team, rebindNodeIds: nodes.map((n) => n.id) };
}
