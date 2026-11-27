// 组织 YAML 导入桥：把服务端同构的 YAML 适配器接入弹窗草稿流。
// 集成到 workbench-web 的包清单后，此文件改为从 @t3tools/workbench-adapters 导入。
import {
  parseOrganizationYaml,
  serializeOrganizationYaml,
} from "../../../../../packages/workbench-adapters/src/yaml/organizationYaml";
import type { OrganizationDraft } from "../../../../../packages/workbench-core/src/teams/organization/index";

export function parseImportedOrganization(
  text: string,
):
  | { ok: true; organization: OrganizationDraft; team: { name: string; description: string } }
  | { ok: false; issues: Array<{ field: string; message: string }> } {
  const parsed = parseOrganizationYaml(text);
  if (!parsed.ok) return parsed;
  return { ok: true, organization: parsed.organization, team: parsed.team };
}

export function serializeOrganizationForExport(
  organization: OrganizationDraft,
  team: { name: string; description: string },
): string {
  return serializeOrganizationYaml(organization, team);
}
