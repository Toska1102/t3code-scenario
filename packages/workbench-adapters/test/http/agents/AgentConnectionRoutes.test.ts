import { describe, expect, it } from "vitest";
import {
  createAgentConnectionRoutes,
  createAgentConnectionsGateway,
  handleAgentConnectionRequest,
} from "../../../src/http/agents/AgentConnectionRoutes.ts";
import { AgentConnections } from "../../../../workbench-core/src/agents/application/AgentConnections.ts";
import { fakeProbe, inMemoryStore } from "../../../../workbench-core/test/agents/fixtures.ts";

const service = new AgentConnections({ store: inMemoryStore(), probe: fakeProbe() });
const shared = createAgentConnectionRoutes(service);
const call = (method: string, path: string, body?: unknown) =>
  handleAgentConnectionRequest(shared, { method, path, body });
// The client the dialog consumes: same routes, driven over a transport,
// against its own service so mutations stay scoped to this suite.
const gatewayService = new AgentConnections({ store: inMemoryStore(), probe: fakeProbe() });
const gateway = createAgentConnectionsGateway((request) =>
  handleAgentConnectionRequest(createAgentConnectionRoutes(gatewayService), request),
);

describe("Agent connection HTTP routes", () => {
  it("serves the redacted device snapshot", async () => {
    const response = await call("GET", "/workbench/agents");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalCount: 3,
      availableCount: 2,
      defaultInstanceId: "codex-local",
    });
    expect(JSON.stringify(response.body)).not.toContain("sk-placeholder");
  });

  it("maps the five write commands onto routes", async () => {
    expect((await call("POST", "/workbench/agents/claude-local/default")).status).toBe(200);
    expect(
      (await call("POST", "/workbench/agents/pi-local/enabled", { enabled: false })).status,
    ).toBe(200);
    expect((await call("POST", "/workbench/agents/pi-local/check", {})).status).toBe(200);
    expect(
      (await call("POST", "/workbench/agents/claude-local/models", { modelId: "review-model" }))
        .status,
    ).toBe(200);
    expect(
      (await call("PATCH", "/workbench/agents/claude-local/models/review-model", { enabled: true }))
        .status,
    ).toBe(200);
    expect(
      (
        await call("PATCH", "/workbench/agents/claude-local", {
          launch: { executable: "claude" },
          envVars: [],
        })
      ).status,
    ).toBe(200);
  });

  it("rejects malformed bodies with a located error instead of casting through unknown", async () => {
    expect(await call("POST", "/workbench/agents/pi-local/enabled", {})).toMatchObject({
      status: 422,
      body: { error: { code: "invalid_request" } },
    });
    expect(
      await call("POST", "/workbench/agents/pi-local/enabled", { enabled: "yes" }),
    ).toMatchObject({
      status: 422,
      body: { error: { code: "invalid_request", field: "enabled" } },
    });
    expect(await call("POST", "/workbench/agents/claude-local/models", {})).toMatchObject({
      status: 422,
      body: { error: { code: "invalid_request", field: "modelId" } },
    });
    expect(
      await call("PATCH", "/workbench/agents/claude-local/models/claude-opus", {}),
    ).toMatchObject({ status: 422, body: { error: { code: "invalid_request" } } });
    expect(await call("PATCH", "/workbench/agents/claude-local", { launch: {} })).toMatchObject({
      status: 422,
      body: { error: { code: "invalid_request", field: "envVars" } },
    });
  });

  it("maps domain errors to statuses and an error contract", async () => {
    const unavailable = await call("POST", "/workbench/agents/pi-local/default");
    expect(unavailable.status).toBe(422);
    expect(unavailable.body).toEqual({ error: { code: "default_unavailable" } });

    const missing = await call("POST", "/workbench/agents/nope/default");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: "instance_not_found" } });

    const invalidModel = await call("POST", "/workbench/agents/claude-local/models", {
      modelId: "a b",
    });
    expect(invalidModel.status).toBe(422);
    expect(invalidModel.body).toEqual({ error: { code: "invalid_model_id", field: "modelId" } });
  });

  it("answers 404 for unknown paths instead of leaking a handler crash", async () => {
    const response = await call("GET", "/workbench/agents/x/unknown");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found" } });
  });
});

describe("Agent connections gateway", () => {
  it("exposes the dialog use cases over the transport and rethrows mapped errors", async () => {
    const snapshot = await gateway.getSnapshot();
    expect(snapshot.availableCount).toBe(2);

    const impact = await gateway.setInstanceEnabled("codex-local", false);
    expect(impact.impact.blocksNewDispatch).toBe(true);

    const promoted = await gateway.setDefaultInstance("claude-local");
    expect(promoted.defaultInstanceId).toBe("claude-local");

    await expect(gateway.setDefaultInstance("pi-local")).rejects.toMatchObject({
      code: "default_unavailable",
    });
    await expect(gateway.addCustomModel("claude-local", "has space")).rejects.toMatchObject({
      code: "invalid_model_id",
    });
    expect(await gateway.addCustomModel("claude-local", "review-model")).toBeDefined();
    expect(await gateway.setModelEnabled("claude-local", "review-model", true)).toBeDefined();
    expect(await gateway.setModelFavorite("claude-local", "review-model", true)).toBeDefined();
    expect(await gateway.saveInstance("claude-local", { launch: {}, envVars: [] })).toBeDefined();
    expect(await gateway.checkConnection("pi-local")).toMatchObject({ status: "available" });
  });
});
