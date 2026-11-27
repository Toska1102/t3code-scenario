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
