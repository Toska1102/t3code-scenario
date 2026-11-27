import { readOnly } from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { ProjectRepository, type Project } from "@t3tools/workbench-core";

const ProjectRow = Schema.Struct({
  id: Schema.String,
  teamId: Schema.NullOr(Schema.String),
  name: Schema.String,
  workDirectory: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  createdBy: Schema.String,
  updatedBy: Schema.String,
});

const COLUMNS = `
  id,
  team_id AS "teamId",
  name,
  work_directory AS "workDirectory",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

const toRepositoryError = (operation: string) => (cause: unknown) =>
  new ProjectRepository.ProjectRepositoryError({ operation, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql.literal(COLUMNS);

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectRow,
    execute: () => sql`SELECT ${columns} FROM workbench_projects ORDER BY created_at, id`,
  });
  const listByTeamRows = SqlSchema.findAll({
    Request: Schema.Struct({ teamId: Schema.NullOr(Schema.String) }),
    Result: ProjectRow,
    execute: ({ teamId }) =>
      teamId === null
        ? sql`SELECT ${columns} FROM workbench_projects WHERE team_id IS NULL ORDER BY created_at, id`
        : sql`SELECT ${columns} FROM workbench_projects WHERE team_id = ${teamId} ORDER BY created_at, id`,
  });
  const byIdRows = SqlSchema.findAll({
    Request: Schema.Struct({ id: Schema.String }),
    Result: ProjectRow,
    execute: ({ id }) => sql`SELECT ${columns} FROM workbench_projects WHERE id = ${id}`,
  });
  const byRequestIdRows = SqlSchema.findAll({
    Request: Schema.Struct({ requestId: Schema.String }),
    Result: ProjectRow,
    execute: ({ requestId }) =>
      sql`SELECT ${columns} FROM workbench_projects WHERE request_id = ${requestId}`,
  });
  const insertRows = SqlSchema.findAll({
    Request: Schema.Struct({
      requestId: Schema.String,
      id: Schema.String,
      teamId: Schema.NullOr(Schema.String),
      name: Schema.String,
      workDirectory: Schema.NullOr(Schema.String),
      createdAt: Schema.String,
      updatedAt: Schema.String,
      createdBy: Schema.String,
      updatedBy: Schema.String,
    }),
    Result: ProjectRow,
    execute: (row) => sql`
      INSERT INTO workbench_projects (
        id, request_id, team_id, name, work_directory,
        created_at, updated_at, created_by, updated_by
      )
      VALUES (
        ${row.id}, ${row.requestId}, ${row.teamId}, ${row.name}, ${row.workDirectory},
        ${row.createdAt}, ${row.updatedAt}, ${row.createdBy}, ${row.updatedBy}
      )
      ON CONFLICT (request_id) DO NOTHING
      RETURNING ${columns}
    `,
  });
  const updateRows = SqlSchema.findAll({
    Request: ProjectRow,
    Result: ProjectRow,
    execute: (row) => sql`
      UPDATE workbench_projects
      SET team_id = ${row.teamId},
          name = ${row.name},
          work_directory = ${row.workDirectory},
          updated_at = ${row.updatedAt},
          updated_by = ${row.updatedBy}
      WHERE id = ${row.id}
      RETURNING ${columns}
    `,
  });

  const findById: ProjectRepository.ProjectRepository["Service"]["findById"] = Effect.fn(
    "SqliteProjects.findById",
  )(
    function* (id) {
      const rows = yield* byIdRows({ id }).pipe(readOnly);
      return Option.getOrUndefined(Option.fromIterable(rows)) ?? null;
    },
    Effect.mapError(toRepositoryError("SqliteProjects.findById")),
  );

  return ProjectRepository.ProjectRepository.of({
    totals: sql<ProjectRepository.WorkbenchTotals>`
      SELECT (SELECT COUNT(*) FROM workbench_teams) AS teams,
             (SELECT COUNT(*) FROM workbench_projects) AS projects,
             (SELECT COUNT(*) FROM workflow_store WHERE key GLOB 'workbench/task/*') AS tasks
    `.pipe(readOnly, Effect.map((rows) => rows[0]!), Effect.mapError(toRepositoryError("totals"))),
    list: Effect.fn("SqliteProjects.list")(
      function* () {
        return yield* listRows(undefined).pipe(readOnly);
      },
      Effect.mapError(toRepositoryError("SqliteProjects.list")),
    ),
    listByTeam: Effect.fn("SqliteProjects.listByTeam")(
      function* (teamId) {
        return yield* listByTeamRows({ teamId }).pipe(readOnly);
      },
      Effect.mapError(toRepositoryError("SqliteProjects.listByTeam")),
    ),
    findById,
    insert: Effect.fn("SqliteProjects.insert")(
      function* (project: Project, requestId: string) {
        const inserted = yield* insertRows({ requestId, ...project });
        const stored = Option.fromIterable(inserted);
        if (Option.isSome(stored)) return stored.value;
        const existing = yield* byRequestIdRows({ requestId });
        return Option.getOrThrow(Option.fromIterable(existing));
      },
      Effect.mapError(toRepositoryError("SqliteProjects.insert")),
    ),
    updateIdentity: Effect.fn("SqliteProjects.updateIdentity")(
      function* (id, identity) {
        const current = yield* findById(id);
        if (current === null) return null;
        const updated = yield* updateRows({
          ...current,
          ...identity,
          id,
        });
        return Option.getOrUndefined(Option.fromIterable(updated)) ?? null;
      },
      Effect.mapError(toRepositoryError("SqliteProjects.updateIdentity")),
    ),
  });
});

export const layer = Layer.effect(ProjectRepository.ProjectRepository, make);
