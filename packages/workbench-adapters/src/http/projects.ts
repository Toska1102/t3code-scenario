import { WorkbenchProjects } from "@t3tools/workbench-contracts";
const { WorkbenchSummary } = WorkbenchProjects;
import { Projects } from "@t3tools/workbench-core";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as WorkbenchActor from "./WorkbenchActor.ts";
import { decodeBody, failure, internal, invalidRequest, json, validation } from "./respond.ts";

const scopeFromQuery = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request): { readonly teamId?: string; readonly unassigned?: true } => {
    const url = new URL(request.url, "http://localhost");
    if (url.searchParams.get("teamId") !== null) {
      return { teamId: url.searchParams.get("teamId") as string };
    }
    if (url.searchParams.get("unassigned") === "true") return { unassigned: true };
    return {};
  },
);

const listProjects = Effect.gen(function* () {
  const projects = yield* Projects.Projects;
  const scope = yield* scopeFromQuery;
  const found =
    "teamId" in scope
      ? yield* projects.listByTeam(scope.teamId)
      : "unassigned" in scope
        ? yield* projects.listByTeam(null)
        : yield* projects.list();
  return json(WorkbenchProjects.ProjectList, { projects: found });
}).pipe(Effect.catchTags({ ProjectRepositoryError: internal }));

const showProject = Effect.gen(function* () {
  const projects = yield* Projects.Projects;
  const { id } = yield* HttpRouter.params;
  const project = yield* projects.findById(id);
  if (project === null) {
    return failure(404, {
      code: "not_found",
      id,
      message: `The project ${id} does not exist.`,
    });
  }
  return json(WorkbenchProjects.Project, project);
}).pipe(Effect.catchTags({ ProjectRepositoryError: internal }));

const createProject = Effect.gen(function* () {
  const projects = yield* Projects.Projects;
  const { subject } = yield* WorkbenchActor.WorkbenchActor;
  const input = yield* decodeBody(WorkbenchProjects.CreateProjectRequest);
  const project = yield* projects.create({
    requestId: input.requestId,
    name: input.name,
    teamId: input.teamId ?? null,
    workDirectory: input.workDirectory ?? null,
    actor: subject,
  });
  return json(WorkbenchProjects.Project, project, 201);
}).pipe(
  Effect.catchTags({
    InvalidRequestBodyError: invalidRequest,
    ProjectIdentityError: validation,
    ProjectTeamMissingError: (error) =>
      Effect.succeed(
        failure(400, {
          code: "validation_failed",
          field: "teamId",
          message: `The team ${error.teamId} does not exist.`,
        }),
      ),
    ProjectNotFoundError: (error) =>
      Effect.succeed(
        failure(404, {
          code: "not_found",
          id: error.id,
          message: `The project ${error.id} does not exist.`,
        }),
      ),
    ProjectRepositoryError: internal,
    TeamRepositoryError: internal,
  }),
);

const updateProject = Effect.gen(function* () {
  const projects = yield* Projects.Projects;
  const { subject } = yield* WorkbenchActor.WorkbenchActor;
  const { id } = yield* HttpRouter.params;
  const input = yield* decodeBody(WorkbenchProjects.UpdateProjectRequest);
  const project = yield* projects.update(id, {
    name: input.name,
    teamId: input.teamId,
    workDirectory: input.workDirectory,
    actor: subject,
  });
  return json(WorkbenchProjects.Project, project);
}).pipe(
  Effect.catchTags({
    InvalidRequestBodyError: invalidRequest,
    ProjectIdentityError: validation,
    ProjectTeamMissingError: (error) =>
      Effect.succeed(
        failure(400, {
          code: "validation_failed",
          field: "teamId",
          message: `The team ${error.teamId} does not exist.`,
        }),
      ),
    ProjectNotFoundError: (error) =>
      Effect.succeed(
        failure(404, {
          code: "not_found",
          id: error.id,
          message: `The project ${error.id} does not exist.`,
        }),
      ),
    ProjectRepositoryError: internal,
    TeamRepositoryError: internal,
  }),
);

/** Home-page counters. Tasks arrive with the dispatch slice; until then none exist. */
const summary = Effect.gen(function* () {
  const projects = yield* Projects.Projects;
  return json(WorkbenchSummary, yield* projects.totals);
}).pipe(Effect.catchTags({ ProjectRepositoryError: internal }));

export const routes = [
  HttpRouter.route("GET", "/projects", listProjects),
  HttpRouter.route("POST", "/projects", createProject),
  HttpRouter.route("GET", "/projects/:id", showProject),
  HttpRouter.route("PUT", "/projects/:id", updateProject),
  HttpRouter.route("GET", "/summary", summary),
];
