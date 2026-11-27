import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { readTeamIdentity, type Team } from "../domain/Team.ts";
import * as TeamRepository from "./TeamRepository.ts";

export class TeamIdentityError extends Schema.TaggedError<TeamIdentityError>()(
  "TeamIdentityError",
  { field: Schema.String, problem: Schema.String },
) {
  override get message(): string {
    return `Team ${this.field} is ${this.problem}.`;
  }
}

export type TeamsError = TeamIdentityError | TeamRepository.TeamRepositoryError;

export interface CreateTeamInput {
  readonly requestId: string;
  readonly name: string;
  readonly description: string | null;
  readonly actor: string;
}

export class Teams extends Context.Service<
  Teams,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Team>, TeamRepository.TeamRepositoryError>;
    readonly findById: (
      id: string,
    ) => Effect.Effect<Team | null, TeamRepository.TeamRepositoryError>;
    readonly create: (input: CreateTeamInput) => Effect.Effect<Team, TeamsError>;
  }
>()("@t3tools/workbench-core/teams/application/Teams") {}

const make = Effect.gen(function* () {
  const repository = yield* TeamRepository.TeamRepository;
  const random = yield* SecureRandom.SecureRandom;

  const create = Effect.fn("Teams.create")(function* (input: CreateTeamInput) {
    const identity = readTeamIdentity(input);
    if (!identity.ok) {
      return yield* new TeamIdentityError({ field: identity.field, problem: identity.problem });
    }
    const id = yield* random.uuidV4();
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    return yield* repository.insert(
      {
        id,
        ...identity.identity,
        createdAt,
        updatedAt: createdAt,
        createdBy: input.actor,
        updatedBy: input.actor,
      },
      input.requestId,
    );
  });

  return Teams.of({
    list: Effect.fn("Teams.list")(function* () {
      return yield* repository.list();
    }),
    findById: Effect.fn("Teams.findById")(function* (id: string) {
      return yield* repository.findById(id);
    }),
    create,
  });
});

export const layer = Layer.effect(Teams, make);
