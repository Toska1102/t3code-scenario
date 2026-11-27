import { describe, expect, it, vi } from "vite-plus/test";

import { createProductClient } from "./productClient";

describe("product HTTP boundary", () => {
  it("reads live teams, project scope, detail and summary using the browser session", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ teams: [], projects: [], id: "project/a", teamsCount: 0 }),
      );
    const client = createProductClient(transport);
    await client.teams();
    await client.projects({ teamId: "team/a" });
    await client.project("project/a");
    await client.summary();
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      "/api/workbench/teams",
      "/api/workbench/projects?teamId=team%2Fa",
      "/api/workbench/projects/project%2Fa",
      "/api/workbench/summary",
    ]);
    for (const [, options] of transport.mock.calls) {
      expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    }
  });

  it("creates with a stable request ID and edits nullable team and directory without an actor payload", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ id: "project-a" }));
    const client = createProductClient(transport);
    await client.createProject({
      requestId: "request-a",
      name: "研究",
      teamId: null,
      workDirectory: null,
    });
    await client.updateProject("project/a", {
      name: "新名称",
      teamId: "team-a",
      workDirectory: "/work/research",
    });
    expect(transport.mock.calls).toMatchObject([
      [
        "/api/workbench/projects",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: "request-a",
            name: "研究",
            teamId: null,
            workDirectory: null,
          }),
        },
      ],
      [
        "/api/workbench/projects/project%2Fa",
        {
          method: "PUT",
          body: JSON.stringify({
            name: "新名称",
            teamId: "team-a",
            workDirectory: "/work/research",
          }),
        },
      ],
    ]);
  });
});
