import * as Context from "effect/Context";

/**
 * The signed-in T3 identity behind one request. The host authenticates the
 * session and provides this; workbench routes never read credentials themselves.
 */
export class WorkbenchActor extends Context.Service<WorkbenchActor, { readonly subject: string }>()(
  "@t3tools/workbench-adapters/http/WorkbenchActor",
) {}
