import { WorkbenchActor } from "@t3tools/workbench-adapters";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpRouter from "effect/http/HttpRouter";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";

const authenticateAdmin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
    Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
      failEnvironmentAuthInvalid(
        EnvironmentAuth.serverAuthCredentialReason(error),
        EnvironmentAuth.serverAuthDpopFailureReason(error),
      ),
    ),
    Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
      failEnvironmentInternal("internal_error", error),
    ),
  );
  if (!session.scopes.includes(AuthSettingsWriteScope)) {
    return yield* failEnvironmentScopeRequired(AuthSettingsWriteScope);
  }
  return WorkbenchActor.WorkbenchActor.of({ subject: session.subject });
});

/**
 * Every workbench route runs as the signed-in session that T3 already
 * authenticated. One scope gates the whole workbench: anyone who may change
 * this environment's settings is a workbench admin, and there is no lesser role.
 */
export const layerAuthenticatedAdmin = HttpRouter.middleware<{
  provides: WorkbenchActor.WorkbenchActor;
}>()((httpEffect) =>
  authenticateAdmin.pipe(
    Effect.flatMap((actor) =>
      Effect.provideService(httpEffect, WorkbenchActor.WorkbenchActor, actor),
    ),
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
    }),
  ),
).layer;
