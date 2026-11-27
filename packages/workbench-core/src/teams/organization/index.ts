// 组织架构后端挂载入口：票 01 的服务组合在此装配存储与 HTTP 适配器。
export {
  createOrganizationService,
  OrganizationInvalidError,
  RevisionConflictError,
} from "./SaveOrganization.ts";
export type {
  OrganizationRepository,
  SaveOrganizationCommand,
  StoredOrganization,
  TeamInfo,
} from "./SaveOrganization.ts";
export {
  MAX_LAYERS,
  isOrganizationValid,
  organizationLayers,
  previewNodeDeletion,
  removeNodes,
  validateOrganization,
  childrenOf,
  descendantsOf,
  findNode,
} from "./Organization.ts";
export type {
  OrganizationDraft,
  OrganizationIssue,
  OrganizationIssueCode,
  OrgNode,
  NodeAssignee,
  NodeId,
  OrgNodeType,
  ReviewRule,
  DeletePreview,
} from "./Organization.ts";
