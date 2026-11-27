import * as HttpRouter from "effect/http/HttpRouter";

import { WORKBENCH_API_PREFIX } from "@t3tools/workbench-contracts/paths";

import * as projects from "./projects.ts";
import * as teams from "./teams.ts";

/**
 * Workbench JSON routes. They require a `WorkbenchActor` per request, which the
 * host's authentication middleware provides, and the use-case services in core.
 */
export const layer = HttpRouter.addAll([...teams.routes, ...projects.routes], {
  prefix: WORKBENCH_API_PREFIX,
});
