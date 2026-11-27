import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Team } from "../domain/Team.ts";

export class TeamRepositoryError extends Schema.TaggedError<TeamRepositoryError>()(
  "TeamRepositoryError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Workbench team storage failed during ${this.operation}.`;
  }
}

export class TeamRepository extends Context.Service<
  TeamRepository,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Team>, TeamRepositoryError>;
    readonly findById: (id: string) => Effect.Effect<Team | null, TeamRepositoryError>;
    /**
     * Stores `team` unless a team was already stored under `requestId`, and
     * answers the team stored under that id either way.
     */
    readonly insert: (team: Team, requestId: string) => Effect.Effect<Team, TeamRepositoryError>;
  }
>()("@t3tools/workbench-core/teams/application/TeamRepository") {}
