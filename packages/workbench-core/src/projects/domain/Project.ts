export interface Project {
  readonly id: string;
  readonly teamId: string | null;
  readonly name: string;
  readonly workDirectory: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** T3 session subjects: who created the project, then who changed it last. */
  readonly createdBy: string;
  readonly updatedBy: string;
}

export interface ProjectIdentity {
  readonly teamId: string | null;
  readonly name: string;
  readonly workDirectory: string | null;
}

export type ProjectField = "name" | "workDirectory";
export type ProjectFieldProblem = "required" | "too_long";
export type ProjectIdentityResult =
  | { readonly ok: true; readonly identity: ProjectIdentity }
  | { readonly ok: false; readonly field: ProjectField; readonly problem: ProjectFieldProblem };

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_WORK_DIRECTORY_MAX_LENGTH = 500;

/**
 * Trims what the admin typed. The name is the only required field; team and
 * work directory may stay unset until a workflow needs them.
 */
export const readProjectIdentity = (input: {
  readonly teamId: string | null;
  readonly name: string;
  readonly workDirectory: string | null;
}): ProjectIdentityResult => {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, field: "name", problem: "required" };
  if (name.length > PROJECT_NAME_MAX_LENGTH)
    return { ok: false, field: "name", problem: "too_long" };
  const workDirectory = input.workDirectory?.trim() ?? "";
  if (workDirectory.length > PROJECT_WORK_DIRECTORY_MAX_LENGTH) {
    return { ok: false, field: "workDirectory", problem: "too_long" };
  }
  return {
    ok: true,
    identity: { teamId: input.teamId, name, workDirectory: workDirectory || null },
  };
};
