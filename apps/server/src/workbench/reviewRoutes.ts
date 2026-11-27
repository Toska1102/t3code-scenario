import * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { createWorkbenchReviewSqliteStore } from "../../../../packages/workbench-adapters/src/sqlite/workbenchReviewSqliteStore.ts";
import { createWorkbenchReviewService } from "../../../../packages/workbench-core/src/tasks/workbenchReviewService.ts";
import { ServerConfig } from "../config.ts";
import { createWorkbenchReviewHttpLayer } from "./workbenchReviewHttp.ts";

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const database = yield* Effect.acquireRelease(
      Effect.sync(() => new NodeSqlite.DatabaseSync(dbPath)),
      (connection) => Effect.sync(() => connection.close()),
    );
    const service = createWorkbenchReviewService({
      store: createWorkbenchReviewSqliteStore(database),
    });
    return createWorkbenchReviewHttpLayer({ service });
  }),
);
