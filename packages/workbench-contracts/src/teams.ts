import * as Schema from "effect/Schema";

export const Team = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
});
export type Team = typeof Team.Type;

export const TeamList = Schema.Struct({
  teams: Schema.Array(Team),
});
export type TeamList = typeof TeamList.Type;

export const CreateTeamRequest = Schema.Struct({
  /** Retrying the same save sends the same id and gets the same team back. */
  requestId: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
});
export type CreateTeamRequest = typeof CreateTeamRequest.Type;
