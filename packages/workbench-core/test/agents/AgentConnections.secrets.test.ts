import { describe, expect, it } from "vitest";
import { SECRET_MASK } from "../../src/agents/domain/AgentAvailability.ts";
import { fakeProbe, inMemoryStore, serviceWith } from "./fixtures.ts";

describe("AgentConnections secret handling", () => {
  it("keeps the stored secret when a masked value round-trips under the same name", async () => {
    const store = inMemoryStore();
    const service = serviceWith(store);

    await service.saveInstance("claude-local", {
      launch: {},
      envVars: [{ name: "ANTHROPIC_API_KEY", value: SECRET_MASK, secret: true }],
    });

    const apiKey = store
      .current()
      .find((instance) => instance.instanceId === "claude-local")
      ?.envVars.find((envVar) => envVar.name === "ANTHROPIC_API_KEY");
    expect(apiKey?.value).toBe("sk-placeholder");
  });

  it("refuses to unmask a masked value: that would store the mask as plaintext", async () => {
    const service = serviceWith();
    await expect(
      service.saveInstance("claude-local", {
        launch: {},
        envVars: [{ name: "ANTHROPIC_API_KEY", value: SECRET_MASK, secret: false }],
      }),
    ).rejects.toMatchObject({ code: "invalid_env_var", field: "ANTHROPIC_API_KEY" });
  });

  it("treats a masked value under an unknown name as an empty new secret, never the mask", async () => {
    const store = inMemoryStore();
    const service = serviceWith(store);

    await service.saveInstance("claude-local", {
      launch: {},
      envVars: [{ name: "NEW_SECRET", value: SECRET_MASK, secret: true }],
    });

    const added = store
      .current()
      .find((instance) => instance.instanceId === "claude-local")
      ?.envVars.find((envVar) => envVar.name === "NEW_SECRET");
    expect(added?.value).toBe("");
  });

  it("a draft health check probes stored secret values, not the mask", async () => {
    const probe = fakeProbe();
    const service = serviceWith(inMemoryStore(), probe);

    await service.checkConnection("claude-local", {
      draft: {
        launch: { executable: "claude" },
        envVars: [
          { name: "ANTHROPIC_BASE_URL", value: "https://api.example.com/v2", secret: false },
          { name: "ANTHROPIC_API_KEY", value: SECRET_MASK, secret: true },
        ],
      },
    });

    const envVars = probe.calls[0] as { envVars: { name: string; value: string }[] };
    const apiKey = envVars.envVars.find((envVar) => envVar.name === "ANTHROPIC_API_KEY");
    expect(apiKey?.value).toBe("sk-placeholder");
    expect(JSON.stringify(probe.calls)).not.toContain(SECRET_MASK);
  });
});
