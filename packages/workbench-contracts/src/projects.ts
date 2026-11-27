import * as Schema from "effect/Schema";

export const Project = Schema.Struct({
  id: Schema.String,
  /** `null` until the admin attaches one; workflows may not be confirmed without a team. */
  teamId: Schema.NullOr(Schema.String),
  name: Schema.String,
  workDirectory: Schema.NullOr(Schema.String),
});
export type Project = typeof Project.Type;

export const ProjectList = Schema.Struct({
  projects: Schema.Array(Project),
});
export type ProjectList = typeof ProjectList.Type;

export const CreateProjectRequest = Schema.Struct({
  /** Retrying the same save sends the same id and gets the same project back. */
  requestId: Schema.String,
  name: Schema.String,
  teamId: Schema.optional(Schema.NullOr(Schema.String)),
  workDirectory: Schema.optional(Schema.NullOr(Schema.String)),
});
export type CreateProjectRequest = typeof CreateProjectRequest.Type;

export const UpdateProjectRequest = Schema.Struct({
  name: Schema.String,
  teamId: Schema.NullOr(Schema.String),
  workDirectory: Schema.NullOr(Schema.String),
});
export type UpdateProjectRequest = typeof UpdateProjectRequest.Type;

/** Home-page counters. Workflows never count as tasks; task rows count once per task id. */
export const WorkbenchSummary = Schema.Struct({
  teams: Schema.Number,
  projects: Schema.Number,
  tasks: Schema.Number,
});
export type WorkbenchSummary = typeof WorkbenchSummary.Type;
