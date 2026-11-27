import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Project } from "../domain/Project.ts";

export class ProjectRepositoryError extends Schema.TaggedError<ProjectRepositoryError>()(
  "ProjectRepositoryError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Workbench project storage failed during ${this.operation}.`;
  }
}

export interface WorkbenchTotals {
  readonly teams: number;
  readonly projects: number;
  readonly tasks: number;
}

export class ProjectRepository extends Context.Service<
  ProjectRepository,
  {
    readonly totals: Effect.Effect<WorkbenchTotals, ProjectRepositoryError>;
    readonly list: () => Effect.Effect<ReadonlyArray<Project>, ProjectRepositoryError>;
    readonly listByTeam: (
      teamId: string | null,
    ) => Effect.Effect<ReadonlyArray<Project>, ProjectRepositoryError>;
    readonly findById: (id: string) => Effect.Effect<Project | null, ProjectRepositoryError>;
    /**
     * Stores `project` unless a project was already stored under `requestId`, and
     * answers the project stored under that id either way.
     */
    readonly insert: (
      project: Project,
      requestId: string,
    ) => Effect.Effect<Project, ProjectRepositoryError>;
    /** Overwrites the identity of `id` while keeping the id itself. */
    readonly updateIdentity: (
      id: string,
      identity: Pick<Project, "teamId" | "name" | "workDirectory" | "updatedAt" | "updatedBy">,
    ) => Effect.Effect<Project | null, ProjectRepositoryError>;
  }
>()("@t3tools/workbench-core/projects/application/ProjectRepository") {}
