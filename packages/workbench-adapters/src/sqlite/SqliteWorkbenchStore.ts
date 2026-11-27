import * as Layer from "effect/Layer";

import * as SqliteProjects from "./SqliteProjects.ts";
import * as SqliteTeams from "./SqliteTeams.ts";
import * as schema from "./schema.ts";

/** Every workbench repository over T3's `SqlClient`, with the schema migrated first. */
export const layer = Layer.mergeAll(SqliteTeams.layer, SqliteProjects.layer).pipe(
  Layer.provide(schema.layerSchema),
);
