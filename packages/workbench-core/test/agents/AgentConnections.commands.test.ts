import { describe, expect, it } from "vitest";
import { AgentConnectionError } from "../../src/agents/application/AgentConnections.ts";
import { SECRET_MASK } from "../../src/agents/domain/AgentAvailability.ts";
import { fakeProbe, inMemoryStore, serviceWith } from "./fixtures.ts";

describe("AgentConnections commands", () => {
  it("setDefaultInstance promotes one available instance and revokes the old default (R13)", async () => {
    const store = inMemoryStore();
    const service = serviceWith(store);
    const snapshot = await service.setDefaultInstance("claude-local");

    expect(snapshot.defaultInstanceId).toBe("claude-local");
    expect(store.current().filter((instance) => instance.isDefault)).toHaveLength(1);
  });

  it("setDefaultInstance refuses an unavailable target", async () => {
    const service = serviceWith();
    await expect(service.setDefaultInstance("pi-local")).rejects.toMatchObject({
      code: "default_unavailable",
    } satisfies Partial<AgentConnectionError>);
  });

  it("setEnabled reports snapshot semantics and does not touch availability of auth (R09)", async () => {
    const service = serviceWith();
    const result = await service.setInstanceEnabled("codex-local", false);
    const snapshot = await service.getSnapshot();

    expect(result.impact.startedStepsContinueOnSnapshot).toBe(true);
    expect(result.impact.blocksNewDispatch).toBe(true);
    expect(snapshot.availableCount).toBe(1);
    expect(
      snapshot.instances.find((instance) => instance.instanceId === "codex-local")?.statusBadge,
    ).toBe("已停用");
  });

  it("checkConnection probes the saved config, records the observation, saves nothing (R: 检查不自动保存)", async () => {
    const store = inMemoryStore();
    const probe = fakeProbe({ status: "not_found", message: "未找到可执行文件" });
    const service = serviceWith(store, probe);

    const outcome = await service.checkConnection("pi-local");

    expect(outcome).toMatchObject({ status: "not_found", evaluatedOrigin: "saved" });
    expect(probe.calls[0]).toMatchObject({ instanceId: "pi-local", provider: "pi" });
    const pi = store.current().find((instance) => instance.instanceId === "pi-local");
    expect(pi?.lastCheck).toMatchObject({ status: "not_found" });
    expect(pi?.launch).toEqual({});
  });

  it("checkConnection evaluates the draft when asked and marks the origin", async () => {
    const probe = fakeProbe({ message: "草稿配置已检测" });
    const service = serviceWith(inMemoryStore(), probe);

    const outcome = await service.checkConnection("codex-local", {
      draft: { launch: { executable: "/opt/codex" }, envVars: [] },
    });

    expect(outcome.evaluatedOrigin).toBe("draft");
    expect(probe.calls[0]).toMatchObject({ launch: { executable: "/opt/codex" } });
  });

  it("addCustomModel adds an unverified model and rejects invalid or duplicate IDs (R08)", async () => {
    const store = inMemoryStore();
    const service = serviceWith(store);

    const snapshot = await service.addCustomModel("claude-local", "  review-model ");
    const added = snapshot.instances
      .find((instance) => instance.instanceId === "claude-local")
      ?.models.find((model) => model.id === "review-model");
    expect(added).toMatchObject({ verified: false, enabled: false, source: "custom" });

    await expect(service.addCustomModel("claude-local", "review-model")).rejects.toMatchObject({
      code: "duplicate_model_id",
    });
    await expect(service.addCustomModel("claude-local", "has space")).rejects.toMatchObject({
      code: "invalid_model_id",
    });
    expect(
      store.current().find((instance) => instance.instanceId === "claude-local")?.models,
    ).toHaveLength(3);
  });

  it("saving a draft keeps the stored secret when the masked value round-trips", async () => {
    const store = inMemoryStore();
    const service = serviceWith(store);

    await service.saveInstance("claude-local", {
      launch: { executable: "claude", configDir: "~/.claude" },
      envVars: [
        { name: "ANTHROPIC_BASE_URL", value: "https://api.example.com/v2", secret: false },
        { name: "ANTHROPIC_API_KEY", value: SECRET_MASK, secret: true },
      ],
    });

    const apiKey = store
      .current()
      .find((instance) => instance.instanceId === "claude-local")
      ?.envVars.find((envVar) => envVar.name === "ANTHROPIC_API_KEY");
    expect(apiKey?.value).toBe("sk-placeholder");
  });

  it("saveInstance rejects empty, malformed or duplicate env var names", async () => {
    const service = serviceWith();
    await expect(
      service.saveInstance("codex-local", {
        launch: {},
        envVars: [{ name: "1BAD", value: "x", secret: false }],
      }),
    ).rejects.toMatchObject({ code: "invalid_env_var" });
    await expect(
      service.saveInstance("codex-local", {
        launch: {},
        envVars: [
          { name: "A", value: "1", secret: false },
          { name: "A", value: "2", secret: false },
        ],
      }),
    ).rejects.toMatchObject({ code: "duplicate_env_var" });
  });

  it("setModelFavorite reorders intent without touching dispatch eligibility", async () => {
    const service = serviceWith();
    const snapshot = await service.setModelFavorite("claude-local", "claude-opus", true);

    const opus = snapshot.instances
      .find((instance) => instance.instanceId === "claude-local")
      ?.models.find((model) => model.id === "claude-opus");
    expect(opus).toMatchObject({ favorite: true, enabled: false });
  });
});
