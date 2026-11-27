import { describe, expect, it, vi } from "vitest";
import { boardOrganization } from "./Organization.test";
import {
  OrganizationInvalidError,
  RevisionConflictError,
  type OrganizationRepository,
  type SaveOrganizationCommand,
  createOrganizationService,
} from "./SaveOrganization";

const savedRevisions: number[] = [];
const repository: OrganizationRepository = {
  async load() {
    return null;
  },
  async save(_teamId, expectedRevision, _data) {
    if (expectedRevision !== 7) throw new RevisionConflictError(7, 8);
    savedRevisions.push(expectedRevision);
    return { revision: 8 };
  },
};

const validCommand = (): SaveOrganizationCommand => ({
  teamId: "team-hr",
  expectedRevision: 7,
  team: { name: "HR 团队", description: "负责组织发展与人力资源运营" },
  organization: boardOrganization(),
});

describe("SaveOrganization", () => {
  it("validates the organization and team, then persists through the repository port", async () => {
    const service = createOrganizationService({ repository });
    const result = await service.saveOrganization(validCommand());
    expect(result).toEqual({ revision: 8 });
    expect(savedRevisions).toEqual([7]);
  });

  it("rejects an invalid organization with located issues and never touches storage", async () => {
    const repository = { load: vi.fn(), save: vi.fn() };
    const service = createOrganizationService({ repository });
    const command = validCommand();
    command.organization.nodes[0]!.name = "  ";
    await expect(service.saveOrganization(command)).rejects.toMatchObject({
      issues: [{ code: "name_required", nodeId: "hr" }],
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("requires a non-blank team name", async () => {
    const service = createOrganizationService({ repository });
    const command = validCommand();
    command.team.name = " ";
    await expect(service.saveOrganization(command)).rejects.toBeInstanceOf(
      OrganizationInvalidError,
    );
  });

  it("surfaces a revision conflict when the stored revision moved", async () => {
    const service = createOrganizationService({ repository });
    const command = validCommand();
    command.expectedRevision = 6;
    await expect(service.saveOrganization(command)).rejects.toBeInstanceOf(RevisionConflictError);
  });
});
