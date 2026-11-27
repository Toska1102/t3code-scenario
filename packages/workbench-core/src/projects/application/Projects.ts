import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as TeamRepository from "../../teams/application/TeamRepository.ts";
import { readProjectIdentity, type Project } from "../domain/Project.ts";
import * as ProjectRepository from "./ProjectRepository.ts";

export class ProjectIdentityError extends Schema.TaggedError<ProjectIdentityError>()(
  "ProjectIdentityError",
  { field: Schema.String, problem: Schema.String },
) {
  override get message(): string {
    return `Project ${this.field} is ${this.problem}.`;
  }
}

export class ProjectTeamMissingError extends Schema.TaggedError<ProjectTeamMissingError>()(
  "ProjectTeamMissingError",
  { teamId: Schema.String },
) {
  override get message(): string {
    return `Project team ${this.teamId} does not exist.`;
  }
}

export class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  { id: Schema.String },
) {
  override get message(): string {
    return `Project ${this.id} does not exist.`;
  }
}

export type ProjectsError =
  | ProjectIdentityError
  | ProjectTeamMissingError
  | ProjectNotFoundError
  | ProjectRepository.ProjectRepositoryError
  | TeamRepository.TeamRepositoryError;

export interface CreateProjectInput {
  readonly requestId: string;
  readonly teamId: string | null;
  readonly name: string;
  readonly workDirectory: string | null;
  readonly actor: string;
}

export interface UpdateProjectInput {
  readonly teamId: string | null;
  readonly name: string;
  readonly workDirectory: string | null;
  readonly actor: string;
}

export class Projects extends Context.Service<
  Projects,
  {
    readonly totals: Effect.Effect<ProjectRepository.WorkbenchTotals, ProjectRepository.ProjectRepositoryError>;
    readonly list: () => Effect.Effect<
      ReadonlyArray<Project>,
      ProjectRepository.ProjectRepositoryError
    >;
    readonly listByTeam: (
      teamId: string | null,
    ) => Effect.Effect<ReadonlyArray<Project>, ProjectRepository.ProjectRepositoryError>;
    readonly findById: (
      id: string,
    ) => Effect.Effect<Project | null, ProjectRepository.ProjectRepositoryError>;
    readonly create: (input: CreateProjectInput) => Effect.Effect<Project, ProjectsError>;
    readonly update: (
      id: string,
      input: UpdateProjectInput,
    ) => Effect.Effect<Project, ProjectsError>;
  }
>()("@t3tools/workbench-core/projects/application/Projects") {}

const make = Effect.gen(function* () {
  const teams = yield* TeamRepository.TeamRepository;
  const requireTeam = Effect.fn("Projects.requireTeam")(function* (teamId: string | null) {
    if (teamId !== null && (yield* teams.findById(teamId)) === null) {
      return yield* new ProjectTeamMissingError({ teamId });
    }
  });
  const repository = yield* ProjectRepository.ProjectRepository;
  const random = yield* SecureRandom.SecureRandom;

  const create = Effect.fn("Projects.create")(function* (input: CreateProjectInput) {
    const identity = readProjectIdentity(input);
    if (!identity.ok) {
      return yield* new ProjectIdentityError({ field: identity.field, problem: identity.problem });
    }
    yield* requireTeam(identity.identity.teamId);
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

  return Projects.of({
    totals: repository.totals,
    list: Effect.fn("Projects.list")(function* () {
      return yield* repository.list();
    }),
    listByTeam: Effect.fn("Projects.listByTeam")(function* (teamId) {
      return yield* repository.listByTeam(teamId);
    }),
    findById: Effect.fn("Projects.findById")(function* (id) {
      return yield* repository.findById(id);
    }),
    create,
    update: Effect.fn("Projects.update")(function* (id, input) {
      const identity = readProjectIdentity(input);
      if (!identity.ok) {
        return yield* new ProjectIdentityError({
          field: identity.field,
          problem: identity.problem,
        });
      }
      yield* requireTeam(identity.identity.teamId);
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      const updated = yield* repository.updateIdentity(id, {
        ...identity.identity,
        updatedAt,
        updatedBy: input.actor,
      });
      if (updated === null) return yield* new ProjectNotFoundError({ id });
      return updated;
    }),
  });
});

export const layer = Layer.effect(Projects, make);
