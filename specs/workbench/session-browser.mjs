import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(import.meta.url);
const { chromium } = require(process.env.WORKBENCH_PLAYWRIGHT ?? "playwright");
const origin = process.env.WORKBENCH_TEST_ORIGIN;
const credential = process.env.WORKBENCH_TEST_CREDENTIAL;
NodeAssert.ok(origin && credential, "Set the isolated test origin and its T3 pairing credential");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const anonymous = await page.request.get(`${origin}/api/workbench/teams`);
  NodeAssert.equal(anonymous.status(), 401, "The T3 server must authenticate team reads");
  await page.goto(origin);
  await page.getByRole("heading", { name: "连接工作台" }).waitFor();
  await page.getByLabel("配对凭据").fill("invalid-test-credential");
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("alert").waitFor();
  const paired = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/browser-session" && response.status() === 200,
  );
  await page.goto(`${origin}/pair#token=${encodeURIComponent(credential)}`);
  await paired;
  await page.waitForFunction(() => !location.href.includes("token="));
  const session = await page.request.get(`${origin}/api/auth/session`);
  NodeAssert.equal((await session.json()).authenticated, true);
  const teamReply = await page.request.post(`${origin}/api/workbench/teams`, {
    data: { requestId: "browser-team", name: "验收团队" },
  });
  NodeAssert.equal(teamReply.status(), 201);
  const team = await teamReply.json();
  const projectInput = { requestId: "browser-project", teamId: team.id, name: " 招聘运营 " };
  const projectReply = await page.request.post(`${origin}/api/workbench/projects`, {
    data: projectInput,
  });
  NodeAssert.equal(projectReply.status(), 201);
  const project = await projectReply.json();
  NodeAssert.equal(project.name, "招聘运营");
  const replay = await page.request.post(`${origin}/api/workbench/projects`, {
    data: projectInput,
  });
  NodeAssert.equal((await replay.json()).id, project.id);
  const update = await page.request.put(`${origin}/api/workbench/projects/${project.id}`, {
    data: { name: "招聘运营二期", teamId: null, workDirectory: null },
  });
  NodeAssert.equal(update.status(), 200);
  const unassigned = await page.request.get(`${origin}/api/workbench/projects?unassigned=true`);
  NodeAssert.ok(
    (await unassigned.json()).projects.some(
      (item) => item.id === project.id && item.name === "招聘运营二期",
    ),
  );
  const totals = await page.request.get(`${origin}/api/workbench/summary`);
  NodeAssert.equal(totals.status(), 200);
  NodeAssert.deepEqual(await totals.json(), { teams: 1, projects: 1, tasks: 0 });
  await page.reload();
  const refreshed = await page.request.get(`${origin}/api/auth/session`);
  NodeAssert.equal((await refreshed.json()).authenticated, true);
  NodeAssert.equal(await page.getByRole("heading", { name: "连接工作台" }).count(), 0);
  console.log(
    "PASS anonymous entry, rejected credential, successful T3 pairing, URL cleanup, session after reload",
  );
} finally {
  await browser.close();
}
