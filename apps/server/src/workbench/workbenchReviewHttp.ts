import { AuthSettingsWriteScope, type EnvironmentInternalError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { WorkbenchReviewService } from "../../../../packages/workbench-core/src/tasks/workbenchReviewService.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";
import * as ServerHttp from "../http.ts";
import { createWorkbenchReviewApp, type WorkbenchReviewAppResponse } from "./workbenchReviewApp.ts";

const authenticateAdmin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* auth.authenticateHttpRequest(request).pipe(
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
  if (!session.scopes.includes(AuthSettingsWriteScope))
    return yield* failEnvironmentScopeRequired(AuthSettingsWriteScope);
  return session.subject;
});

const respond = Effect.fn("WorkbenchReviewHttp.respond")(
  (action: () => WorkbenchReviewAppResponse<unknown>) =>
    Effect.try({ try: action, catch: (error) => error }).pipe(
      Effect.map((response) =>
        HttpServerResponse.jsonUnsafe(response.body, {
          status: response.status,
          headers: { "cache-control": "no-store" },
        }),
      ),
      Effect.catch((error) => failEnvironmentInternal("internal_error", error)),
    ),
);

const withAdmin = <Requirements>(
  handle: (
    subject: string,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, EnvironmentInternalError, Requirements>,
) =>
  authenticateAdmin.pipe(
    Effect.flatMap(handle),
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
    }),
  );

export function createWorkbenchReviewHttpLayer(deps: { service: WorkbenchReviewService }) {
  const app = createWorkbenchReviewApp(deps);
  return HttpRouter.addAll(
    [
      HttpRouter.route(
        "GET",
        "/reviews",
        withAdmin((authenticatedUserId) => respond(() => app.handleQueue({ authenticatedUserId }))),
      ),
      HttpRouter.route(
        "GET",
        "/tasks/:taskId/review",
        withAdmin((authenticatedUserId) =>
          Effect.gen(function* () {
            const { taskId } = yield* HttpRouter.params;
            return yield* respond(() =>
              app.handleTaskSnapshot({ authenticatedUserId, taskId: taskId! }),
            );
          }),
        ),
      ),
      HttpRouter.route(
        "POST",
        "/reviews/decide",
        withAdmin((authenticatedUserId) =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            return yield* request.json.pipe(
              Effect.matchEffect({
                onFailure: () =>
                  Effect.succeed(
                    HttpServerResponse.jsonUnsafe(
                      {
                        error: {
                          code: "invalid_request",
                          message: "Expected a JSON review decision",
                        },
                      },
                      { status: 400 },
                    ),
                  ),
                onSuccess: (body) => respond(() => app.handleDecide({ authenticatedUserId, body })),
              }),
            );
          }),
        ),
      ),
    ],
    { prefix: "/api/workbench" },
  ).pipe(Layer.provide(ServerHttp.layerApiBodyLimit));
}
