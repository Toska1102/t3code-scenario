import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Migrator from "effect/sql/Migrator";

/**
 * Schema changes append here and never edit a released entry. The workbench keeps
 * its own ledger in the T3 database, so T3's migration history stays untouched.
 */
const migrations = {
  "1_Teams": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE workbench_teams (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL
      ) WITHOUT ROWID
    `;
  }),
  "2_Projects": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE workbench_projects (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        team_id TEXT REFERENCES workbench_teams (id),
        name TEXT NOT NULL,
        work_directory TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL
      ) WITHOUT ROWID
    `;
    yield* sql`CREATE INDEX workbench_projects_team_id ON workbench_projects (team_id)`;
  }),
} as const satisfies Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>;

const migrate = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
  table: "workbench_sql_migrations",
});

/** Brings the workbench tables up to date before any store serves a request. */
export const layerSchema = Layer.effectDiscard(migrate);
