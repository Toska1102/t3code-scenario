// 组织架构前端挂载入口。票 01 的应用在此挂载：
//   import { OrganizationDialog } from '.../features/teams/organization';
//   <OrganizationDialog team={team} revision={revision} organization={org}
//     people={people} agentInstances={instances} onSave={save} onClose={close} />
export { OrganizationDialog } from "./OrganizationDialog";
export type {
  OrganizationDialogProps,
  PersonRef,
  AgentInstanceRef,
  SaveOrganizationPayload,
  SaveOrganizationResult,
} from "./OrganizationDialog";
