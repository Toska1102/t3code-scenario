export interface Team {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** T3 session subjects: who created the team, then who changed it last. */
  readonly createdBy: string;
  readonly updatedBy: string;
}

export interface TeamIdentity {
  readonly name: string;
  readonly description: string | null;
}

export type TeamField = "name" | "description";
export type TeamFieldProblem = "required" | "too_long";
export type TeamIdentityResult =
  | { readonly ok: true; readonly identity: TeamIdentity }
  | { readonly ok: false; readonly field: TeamField; readonly problem: TeamFieldProblem };

export const TEAM_NAME_MAX_LENGTH = 80;
export const TEAM_DESCRIPTION_MAX_LENGTH = 500;

/** Trims what the admin typed; a blank description means none. */
export const readTeamIdentity = (input: {
  readonly name: string;
  readonly description: string | null;
}): TeamIdentityResult => {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, field: "name", problem: "required" };
  if (name.length > TEAM_NAME_MAX_LENGTH) return { ok: false, field: "name", problem: "too_long" };
  const description = input.description?.trim() ?? "";
  if (description.length > TEAM_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, field: "description", problem: "too_long" };
  }
  return { ok: true, identity: { name, description: description || null } };
};
