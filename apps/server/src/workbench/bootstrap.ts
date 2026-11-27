import * as WorkbenchAdapters from "@t3tools/workbench-adapters";
import { Projects, Teams } from "@t3tools/workbench-core";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";

import * as ServerHttp from "../http.ts";
import * as auth from "./auth.ts";

const { SqliteWorkbenchStore, WorkbenchHttp } = WorkbenchAdapters;

/** The workbench inside the T3 server: SQLite storage, use cases, and HTTP routes. */
export const layer = WorkbenchHttp.layer.pipe(
  Layer.provide(auth.layerAuthenticatedAdmin),
  HttpRouter.provideRequest(
    Layer.merge(Teams.layer, Projects.layer).pipe(Layer.provide(SqliteWorkbenchStore.layer)),
  ),
  Layer.provide(ServerHttp.layerApiBodyLimit),
);
