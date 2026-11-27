import { readOnly } from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { TeamRepository, type Team } from "@t3tools/workbench-core";

const TeamRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  createdBy: Schema.String,
  updatedBy: Schema.String,
});

const COLUMNS = `
  id,
  name,
  description,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  created_by AS "createdBy",
  updated_by AS "updatedBy"
`;

const toRepositoryError = (operation: string) => (cause: unknown) =>
  new TeamRepository.TeamRepositoryError({ operation, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql.literal(COLUMNS);

  const selectRows = SqlSchema.findAll({
    Request: Schema.Struct({ id: Schema.String }),
    Result: TeamRow,
    execute: ({ id }) => sql`SELECT ${columns} FROM workbench_teams WHERE id = ${id}`,
  });
  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TeamRow,
    execute: () => sql`SELECT ${columns} FROM workbench_teams ORDER BY created_at, id`,
  });
  const byRequestIdRows = SqlSchema.findAll({
    Request: Schema.Struct({ requestId: Schema.String }),
    Result: TeamRow,
    execute: ({ requestId }) =>
      sql`SELECT ${columns} FROM workbench_teams WHERE request_id = ${requestId}`,
  });
  const insertRows = SqlSchema.findAll({
    Request: Schema.Struct({
      id: Schema.String,
      requestId: Schema.String,
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
      createdAt: Schema.String,
      updatedAt: Schema.String,
      createdBy: Schema.String,
      updatedBy: Schema.String,
    }),
    Result: TeamRow,
    execute: (row) => sql`
      INSERT INTO workbench_teams (
        id, request_id, name, description, created_at, updated_at, created_by, updated_by
      )
      VALUES (
        ${row.id},
        ${row.requestId},
        ${row.name},
        ${row.description},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.createdBy},
        ${row.updatedBy}
      )
      ON CONFLICT (request_id) DO NOTHING
      RETURNING ${columns}
    `,
  });

  const findById: TeamRepository.TeamRepository["Service"]["findById"] = Effect.fn(
    "SqliteTeams.findById",
  )(
    function* (id) {
      const rows = yield* selectRows({ id }).pipe(readOnly);
      return Option.getOrUndefined(Option.fromIterable(rows)) ?? null;
    },
    Effect.mapError(toRepositoryError("SqliteTeams.findById")),
  );

  return TeamRepository.TeamRepository.of({
    list: Effect.fn("SqliteTeams.list")(
      function* () {
        return yield* listRows(undefined).pipe(readOnly);
      },
      Effect.mapError(toRepositoryError("SqliteTeams.list")),
    ),
    findById,
    insert: Effect.fn("SqliteTeams.insert")(
      function* (team: Team, requestId: string) {
        const inserted = yield* insertRows({ requestId, ...team });
        const stored = Option.fromIterable(inserted);
        if (Option.isSome(stored)) return stored.value;
        const existing = yield* byRequestIdRows({ requestId });
        return Option.getOrThrow(Option.fromIterable(existing));
      },
      Effect.mapError(toRepositoryError("SqliteTeams.insert")),
    ),
  });
});

export const layer = Layer.effect(TeamRepository.TeamRepository, make);
