import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createServer } from "vite-plus";
import * as NodeTimersPromises from "node:timers/promises";

const repo = NodePath.resolve(import.meta.dirname, "../..");
const web = NodePath.join(repo, "apps/workbench-web");
const requireWeb = NodeModule.createRequire(NodePath.join(web, "package.json"));
const ip = "127.0.0.1";
const state = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-browser-"));
const credential = NodeCrypto.randomBytes(32).toString("hex");

async function freePort() {
  const server = NodeNet.createServer();
  server.listen(0, ip);
  await NodeEvents.once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const apiPort = await freePort();
const apiOrigin = `http://${ip}:${apiPort}`;
let backend;
let frontend;
try {
  frontend = await createServer({
    root: web,
    logLevel: "error",
    server: { host: ip, port: 0, proxy: { "/api": apiOrigin } },
  });
  await frontend.listen();
  const origin = `http://${ip}:${frontend.httpServer.address().port}`;
  backend = NodeChildProcess.spawn(
    process.execPath,
    [
      "src/bin.ts",
      "serve",
      "--no-browser",
      "--host",
      ip,
      "--port",
      String(apiPort),
      "--base-dir",
      state,
      "--dev-url",
      origin,
    ],
    {
      cwd: NodePath.join(repo, "apps/server"),
      env: { ...process.env, T3CODE_DEV_AUTH_TOKEN: credential },
      stdio: "ignore",
    },
  );
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (backend.exitCode !== null || backend.signalCode !== null)
      throw new Error("Isolated T3 server exited before readiness");
    const response = await fetch(`${apiOrigin}/api/auth/session`, {
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null);
    if (response?.ok && (await response.json()).authenticated === false) break;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the isolated T3 auth route");
    await NodeTimersPromises.setTimeout(250);
  }
  const probe = NodeChildProcess.spawn(
    process.execPath,
    [NodePath.join(import.meta.dirname, "session-browser.mjs")],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        WORKBENCH_PLAYWRIGHT: requireWeb.resolve("playwright"),
        WORKBENCH_TEST_ORIGIN: origin,
        WORKBENCH_TEST_CREDENTIAL: credential,
      },
    },
  );
  const [code] = await NodeEvents.once(probe, "exit");
  if (code !== 0) process.exitCode = 1;
} finally {
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    const closed = NodeEvents.once(backend, "exit");
    backend.kill("SIGTERM");
    const timeout = setTimeout(() => backend.kill("SIGKILL"), 10_000);
    try {
      await closed;
    } finally {
      clearTimeout(timeout);
    }
  }
  await frontend?.close();
  await NodeFSP.rm(state, { recursive: true, force: true });
}
