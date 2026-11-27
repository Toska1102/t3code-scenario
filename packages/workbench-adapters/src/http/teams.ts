import { WorkbenchTeams } from "@t3tools/workbench-contracts";
import { Teams } from "@t3tools/workbench-core";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";

import * as WorkbenchActor from "./WorkbenchActor.ts";
import { decodeBody, internal, invalidRequest, json, validation } from "./respond.ts";

const listTeams = Effect.gen(function* () {
  const teams = yield* Teams.Teams;
  const list = yield* teams.list();
  return json(WorkbenchTeams.TeamList, { teams: list });
}).pipe(Effect.catchTags({ TeamRepositoryError: internal }));

const createTeam = Effect.gen(function* () {
  const teams = yield* Teams.Teams;
  const { subject } = yield* WorkbenchActor.WorkbenchActor;
  const input = yield* decodeBody(WorkbenchTeams.CreateTeamRequest);
  const team = yield* teams.create({
    requestId: input.requestId,
    name: input.name,
    description: input.description ?? null,
    actor: subject,
  });
  return json(WorkbenchTeams.Team, team, 201);
}).pipe(
  Effect.catchTags({
    InvalidRequestBodyError: invalidRequest,
    TeamIdentityError: validation,
    TeamRepositoryError: internal,
  }),
);

export const routes = [
  HttpRouter.route("GET", "/teams", listTeams),
  HttpRouter.route("POST", "/teams", createTeam),
];
