import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as AuthHttp from "../auth/http.ts";
import * as Workbench from "./bootstrap.ts";

const DEV_TOKEN = "workbench-api-test-dev-token";
class AuthTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}

const layerConfig = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return {
      ...config,
      mode: "web",
      devUrl: new URL("http://127.0.0.1:5173"),
      devAuthToken: Redacted.make(DEV_TOKEN),
    } satisfies ServerConfig.ServerConfig["Service"];
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-workbench-test-" })));

const layerEnvironmentAuth = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(layerConfig),
);

const layerRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(AuthTestApi).pipe(
    Layer.provide(AuthHttp.layer),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
  ),
  Workbench.layer,
).pipe(
  Layer.provideMerge(layerEnvironmentAuth),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(layerConfig),
  Layer.provide(HttpPlatform.layer.pipe(Layer.provideMerge(Etag.layerWeak))),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

interface Input {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** Each caller is one signed-in identity, or none, talking to the workbench API. */
interface Callers {
  /** The reusable dev token, whose session holds every administrative scope. */
  readonly admin: (input: Input) => Effect.Effect<Reply>;
  /** No credential at all. */
  readonly anonymous: (input: Input) => Effect.Effect<Reply>;
  /** A session that is signed in but was granted only `orchestration:read`. */
  readonly reader: (input: Input) => Effect.Effect<Reply>;
}

const send =
  (handler: (request: Request) => Promise<Response>, cookie?: string) =>
  ({ method, path, body }: Input): Effect.Effect<Reply> =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://127.0.0.1${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(cookie ? { cookie } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      return {
        status: response.status,
        body: response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : await response.text(),
      };
    });

const signIn = (handler: (request: Request) => Promise<Response>, credential: string) =>
  Effect.promise(async () => {
    const response = await handler(
      new Request("http://127.0.0.1/api/auth/browser-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      }),
    );
    expect(response.status).toBe(200);
    return (response.headers.getSetCookie()[0] ?? "").split(";", 1)[0];
  });

/** Runs `test` against one workbench behind the real auth routes and an in-memory database. */
const withCallers = <A>(
  test: (callers: Callers) => Generator<Effect.Effect<A>, A>,
): Effect.Effect<A, never, NodeServices.NodeServices> =>
  Effect.gen(function* () {
    const { handler, dispose } = yield* Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(layerRoutes, { disableLogger: false })),
      (_) => Effect.promise(dispose),
    );
    const admin = yield* signIn(handler, DEV_TOKEN);
    const pairing = yield* send(
      handler,
      admin,
    )({
      method: "POST",
      path: "/api/auth/pairing-token",
      body: { scopes: ["orchestration:read"] },
    });
    const reader = yield* signIn(handler, (pairing.body as { credential: string }).credential);
    return yield* test({
      admin: send(handler, admin),
      anonymous: send(handler),
      reader: send(handler, reader),
    });
  });

const teamInput = {
  requestId: "request-team-1",
  name: "HR 团队",
  description: "负责组织发展与人力资源运营",
};

it.effect("an authenticated admin creates a team that a later request lists", () =>
  withCallers(function* (callers) {
    expect(
      (yield* callers.anonymous({ method: "POST", path: "/api/workbench/teams", body: teamInput }))
        .status,
    ).toBe(401);
    expect(
      (yield* callers.reader({ method: "POST", path: "/api/workbench/teams", body: teamInput }))
        .status,
    ).toBe(403);

    const created = yield* callers.admin({
      method: "POST",
      path: "/api/workbench/teams",
      body: teamInput,
    });
    expect(created.status).toBe(201);
    const teamId = (created.body as { id: string }).id;

    const listed = yield* callers.admin({ method: "GET", path: "/api/workbench/teams" });
    expect(listed.body).toEqual({
      teams: [{ id: teamId, name: "HR 团队", description: "负责组织发展与人力资源运营" }],
    });

    const summary = yield* callers.admin({ method: "GET", path: "/api/workbench/summary" });
    expect(summary.status).toBe(200);
    expect(summary.body).toEqual({ teams: 1, projects: 0, tasks: 0 });
  }),
);

const projectInput = {
  requestId: "request-project-1",
  name: "  招聘运营  ",
  teamId: "missing-by-default",
};

it.effect("an admin creates projects with a trimmed name and edits them in place", () =>
  withCallers(function* (callers) {
    const team = yield* callers.admin({
      method: "POST",
      path: "/api/workbench/teams",
      body: teamInput,
    });
    const teamId = (team.body as { id: string }).id;

    expect(
      (yield* callers.anonymous({
        method: "POST",
        path: "/api/workbench/projects",
        body: { ...projectInput, teamId },
      })).status,
    ).toBe(401);

    // A blank name is rejected with the field located, and the retry that works keeps its id.
    const blank = yield* callers.admin({
      method: "POST",
      path: "/api/workbench/projects",
      body: { requestId: "request-project-blank", name: "   " },
    });
    expect(blank.status).toBe(400);
    expect(blank.body).toMatchObject({ error: { code: "validation_failed", field: "name" } });

    const created = yield* callers.admin({
      method: "POST",
      path: "/api/workbench/projects",
      body: { ...projectInput, teamId },
    });
    expect(created.status).toBe(201);
    const project = created.body as {
      id: string;
      name: string;
      teamId: string | null;
      workDirectory: string | null;
    };
    expect(project.name).toBe("招聘运营");
    expect(project.teamId).toBe(teamId);

    // Retrying the same submission does not create a second project.
    const retry = yield* callers.admin({
      method: "POST",
      path: "/api/workbench/projects",
      body: { ...projectInput, teamId },
    });
    expect(retry.status).toBe(201);
    expect((retry.body as { id: string }).id).toBe(project.id);

    // An unknown team cannot be attached.
    const unknownTeam = yield* callers.admin({
      method: "POST",
      path: "/api/workbench/projects",
      body: {
        requestId: "request-project-unknown-team",
        name: "薪酬核算",
        teamId: "team-does-not-exist",
      },
    });
    expect(unknownTeam.status).toBe(400);

    // The unassigned list holds projects without a team; the team list holds this one.
    const teamProjects = yield* callers.admin({
      method: "GET",
      path: `/api/workbench/projects?teamId=${teamId}`,
    });
    expect(teamProjects.body).toEqual({ projects: [project] });
    const unassigned = yield* callers.admin({
      method: "GET",
      path: "/api/workbench/projects?unassigned=true",
    });
    expect(unassigned.body).toEqual({ projects: [] });

    // Editing keeps the project id and can clear the team and directory.
    const updated = yield* callers.admin({
      method: "PUT",
      path: `/api/workbench/projects/${project.id}`,
      body: { name: "招聘运营二期", teamId: null, workDirectory: "~/work/recruiting" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({
      id: project.id,
      name: "招聘运营二期",
      teamId: null,
      workDirectory: "~/work/recruiting",
    });
    const afterUpdate = yield* callers.admin({
      method: "GET",
      path: "/api/workbench/projects?unassigned=true",
    });
    expect(
      (afterUpdate.body as { projects: Array<{ id: string }> }).projects.map((p) => p.id),
    ).toEqual([project.id]);

    expect(
      (yield* callers.admin({ method: "GET", path: "/api/workbench/projects/no-such-project" }))
        .status,
    ).toBe(404);

    const summary = yield* callers.admin({ method: "GET", path: "/api/workbench/summary" });
    expect(summary.body).toEqual({ teams: 1, projects: 1, tasks: 0 });
  }),
);
