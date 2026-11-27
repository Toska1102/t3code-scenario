// 保存组织配置用例：校验后经仓库端口持久化，失败时不触碰存储。
// 规格故事 7：组织草稿与团队信息一起保存；故事 31/D02：以修订号识别并发变更。
import {
  validateOrganization,
  type OrganizationDraft,
  type OrganizationIssue,
} from "./Organization.ts";

export interface TeamInfo {
  name: string;
  description: string;
}

export interface StoredOrganization {
  revision: number;
  team: TeamInfo;
  organization: OrganizationDraft;
}

export interface OrganizationRepository {
  load(teamId: string): Promise<StoredOrganization | null>;
  save(
    teamId: string,
    expectedRevision: number,
    data: { team: TeamInfo; organization: OrganizationDraft },
  ): Promise<{ revision: number }>;
}

export interface SaveOrganizationCommand {
  teamId: string;
  /** 客户端基于的修订；与存储不一致时拒绝保存。 */
  expectedRevision: number;
  team: TeamInfo;
  organization: OrganizationDraft;
}

// @effect-diagnostics-next-line extendsNativeError:off -- Domain errors are shared with the browser.
export class OrganizationInvalidError extends Error {
  readonly issues: OrganizationIssue[];
  constructor(issues: OrganizationIssue[]) {
    super("组织配置未通过校验");
    this.name = "OrganizationInvalidError";
    this.issues = issues;
  }
}

// @effect-diagnostics-next-line extendsNativeError:off -- The repository exposes this conflict through its Promise port.
export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number;
  constructor(expectedRevision: number, currentRevision: number) {
    super(`组织已被其他保存更新（期望修订 ${expectedRevision}，当前 ${currentRevision}）`);
    this.name = "RevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export function createOrganizationService(deps: { repository: OrganizationRepository }) {
  return {
    async loadOrganization(teamId: string): Promise<StoredOrganization | null> {
      return deps.repository.load(teamId);
    },

    async saveOrganization(command: SaveOrganizationCommand): Promise<{ revision: number }> {
      const issues = validateOrganization(command.organization);
      if (!command.team.name.trim()) {
        issues.push({ code: "name_required", message: "团队名称必填" });
      }
      if (issues.length > 0) {
        throw new OrganizationInvalidError(issues);
      }
      return deps.repository.save(command.teamId, command.expectedRevision, {
        team: { ...command.team, name: command.team.name.trim() },
        organization: command.organization,
      });
    },
  };
}
