// 组织 YAML 适配器挂载入口（票 01 的 HTTP 适配器在此装配导出/导入预览接口）。
export {
  ORGANIZATION_YAML_FORMAT_VERSION,
  parseOrganizationYaml,
  serializeOrganizationYaml,
} from "./organizationYaml.ts";
export type { ParseOrganizationYamlResult } from "./organizationYaml.ts";
