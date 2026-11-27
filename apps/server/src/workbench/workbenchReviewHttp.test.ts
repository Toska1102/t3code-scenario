import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { createWorkbenchReviewSqliteStore } from "../../../../packages/workbench-adapters/src/sqlite/workbenchReviewSqliteStore.ts";
import { createWorkbenchReviewService } from "../../../../packages/workbench-core/src/tasks/workbenchReviewService.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as AuthHttp from "../auth/http.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { createWorkbenchReviewHttpLayer } from "./workbenchReviewHttp.ts";

const credential = "workbench-review-http-test-token";
class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

const layerConfig = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return {
      ...config,
      mode: "web" as const,
      devUrl: new URL("http://127.0.0.1:5173"),
      devAuthToken: Redacted.make(credential),
    };
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-review-http-" })));

const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(layerConfig),
);

it.effect(
  "real T3 auth gates SQLite review HTTP and records the session actor, not the claimed actor",
  () =>
    Effect.gen(function* () {
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => new NodeSqlite.DatabaseSync(":memory:")),
        (connection) => Effect.sync(() => connection.close()),
      );
      const service = createWorkbenchReviewService({
        store: createWorkbenchReviewSqliteStore(database),
      });
      service.createTask({
        taskId: "task-025",
        steps: [
          { stepId: "draft", dependsOn: [], executor: "Codex" },
          { stepId: "review", dependsOn: ["draft"], executor: "HR", reviewerId: "reviewer" },
        ],
      });
      service.completeStep({ taskId: "task-025", stepId: "draft" });
      const layer = Layer.mergeAll(
        HttpApiBuilder.layer(AuthTestApi).pipe(
          Layer.provide(AuthHttp.layer),
          Layer.provide(AuthHttp.layerAuthenticatedAuth),
        ),
        createWorkbenchReviewHttpLayer({ service }),
      ).pipe(
        Layer.provideMerge(layerAuth),
        Layer.provide(layerConfig),
        Layer.provide(HttpPlatform.layer.pipe(Layer.provideMerge(Etag.layerWeak))),
        Layer.provideMerge(ServerSecretStore.layer.pipe(Layer.provide(layerConfig))),
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
      const { handler } = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(layer, { disableLogger: true })),
        (web) => Effect.promise(web.dispose),
      );
      const send = (path: string, cookie?: string, body?: unknown) =>
        Effect.promise(() =>
          handler(
            new Request(`http://127.0.0.1${path}`, {
              method: body === undefined ? "GET" : "POST",
              headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
          ),
        );
      expect((yield* send("/api/workbench/reviews")).status).toBe(401);
      const login = yield* send("/api/auth/browser-session", undefined, { credential });
      expect(login.status).toBe(200);
      const cookie = login.headers.getSetCookie()[0]!.split(";", 1)[0]!;
      const pairing = yield* send("/api/auth/pairing-token", cookie, {
        scopes: ["orchestration:read"],
      });
      expect(pairing.status).toBe(200);
      const pairingBody = (yield* Effect.promise(() => pairing.json())) as { credential: string };
      const readerLogin = yield* send("/api/auth/browser-session", undefined, pairingBody);
      const readerCookie = readerLogin.headers.getSetCookie()[0]!.split(";", 1)[0]!;
      expect((yield* send("/api/workbench/reviews", readerCookie)).status).toBe(403);
      const input = {
        taskId: "task-025",
        stepId: "review",
        attempt: 1,
        decision: "approve",
        requestId: "http-decision",
        actorId: "forged-actor",
      };
      expect((yield* send("/api/workbench/reviews/decide", readerCookie, input)).status).toBe(403);
      const queue = yield* send("/api/workbench/reviews?reviewerId=reviewer", cookie);
      expect(queue.headers.get("cache-control")).toBe("no-store");
      expect((yield* send("/api/workbench/reviews/decide", cookie, [])).status).toBe(400);
      expect(
        (yield* send("/api/workbench/reviews/decide", cookie, { ...input, attempt: -1 })).status,
      ).toBe(400);
      expect(yield* Effect.promise(() => queue.json())).toEqual({ reviews: [] });
      const result = yield* send("/api/workbench/reviews/decide", cookie, input);
      expect(result.status).toBe(200);
      const body = yield* Effect.promise(() => result.json());
      expect(body).toMatchObject({
        review: { assignedReviewerId: "reviewer", decidedByActorId: "reusable-dev-token" },
      });
      const retry = yield* send("/api/workbench/reviews/decide", cookie, input);
      expect(retry.status).toBe(200);
      expect(yield* Effect.promise(() => retry.json())).toEqual(body);
      expect(
        (yield* send("/api/workbench/reviews/decide", cookie, {
          ...input,
          requestId: "different-request",
        })).status,
      ).toBe(409);
      const snapshot = yield* send("/api/workbench/tasks/task-025/review", cookie);
      expect(snapshot.status).toBe(200);
      expect(yield* Effect.promise(() => snapshot.json())).toMatchObject({
        task: { stepRuns: { review: { status: "approved" } } },
      });
    }),
);
