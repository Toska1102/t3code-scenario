import { describe, expect, it } from "vitest";
import { createAgentConnectionsViewModel } from "../AgentConnectionsViewModel.ts";
import { AgentConnections } from "../../../../../packages/workbench-core/src/agents/application/AgentConnections.ts";
import {
  fakeProbe,
  inMemoryStore,
} from "../../../../../packages/workbench-core/test/agents/fixtures.ts";

function viewModel() {
  const store = inMemoryStore();
  const service = new AgentConnections({
    store,
    probe: fakeProbe(),
  });
  return { store, service, vm: createAgentConnectionsViewModel({ gateway: service }) };
}

describe("Agent connections view model", () => {
  it("opens on the first instance and exposes the device counters", async () => {
    const { vm } = viewModel();
    await vm.open();

    expect(vm.selectedInstanceId).toBe("pi-local");
    expect(vm.summary).toMatchObject({ totalCount: 3, availableCount: 2 });
    expect(vm.summary.instances.find((instance) => instance.provider === "pi")?.statusBadge).toBe(
      "需要认证",
    );
  });

  it("keeps a separate draft per instance while switching (story 42)", async () => {
    const { vm } = viewModel();
    await vm.open();

    vm.editLaunch("pi-local", { executable: "pi-custom" });
    expect(vm.hasUnsavedChanges).toBe(true);

    vm.selectInstance("codex-local");
    expect(vm.draftFor("codex-local").launch).toEqual({});
    // Unsaved changes are dialog-global: Pi's draft stays pending.
    expect(vm.hasUnsavedChanges).toBe(true);

    vm.selectInstance("pi-local");
    expect(vm.draftFor("pi-local").launch).toEqual({ executable: "pi-custom" });
    expect(vm.hasUnsavedChanges).toBe(true);
  });

  it("save persists the edited draft, clears it, and refreshes counters", async () => {
    const { store, vm } = viewModel();
    await vm.open();
    vm.selectInstance("claude-local");
    vm.editEnvVars("claude-local", [
      { name: "ANTHROPIC_API_KEY", value: "••••••••", secret: true },
    ]);

    await vm.saveSelected();

    expect(vm.hasUnsavedChanges).toBe(false);
    expect(vm.draftFor("claude-local").envVars).toHaveLength(1);
    const apiKey = store
      .current()
      .find((instance) => instance.instanceId === "claude-local")
      ?.envVars.find((envVar) => envVar.name === "ANTHROPIC_API_KEY");
    expect(apiKey?.value).toBe("sk-placeholder");
  });

  it("discard restores the last saved values", async () => {
    const { vm } = viewModel();
    await vm.open();
    vm.editLaunch("pi-local", { executable: "changed" });

    vm.discardSelected();

    expect(vm.hasUnsavedChanges).toBe(false);
    expect(vm.draftFor("pi-local").launch).toEqual({});
  });

  it("disable refreshes the available count and keeps the default independent", async () => {
    const { vm } = viewModel();
    await vm.open();

    await vm.setEnabled("codex-local", false);

    expect(vm.summary).toMatchObject({ availableCount: 1, defaultInstanceId: "codex-local" });
  });

  it("setDefault switches the badge and count stays available-driven (R13)", async () => {
    const { vm } = viewModel();
    await vm.open();

    await vm.setDefault("claude-local");

    expect(vm.summary.defaultInstanceId).toBe("claude-local");
    expect(vm.summary.availableCount).toBe(2);
  });

  it("checkConnection flags the pending draft as the evaluated origin (检查待保存状态)", async () => {
    const { vm } = viewModel();
    await vm.open();
    vm.editLaunch("pi-local", { executable: "pi-draft" });

    const outcome = await vm.checkSelected();

    expect(outcome).toMatchObject({ evaluatedOrigin: "draft" });
    expect(vm.lastCheckFor("pi-local")).toMatchObject({ status: "available" });
  });

  it("refuses to promote an unavailable instance as default", async () => {
    const { vm } = viewModel();
    await vm.open();

    await expect(vm.setDefault("pi-local")).rejects.toMatchObject({ code: "default_unavailable" });
  });
});

describe("Agent connections view model: models", () => {
  it("addCustomModel appends an unverified model and refreshes the summary", async () => {
    const { vm } = viewModel();
    await vm.open();

    await vm.addCustomModel("claude-local", "review-model");

    const models = vm.summary.instances.find((i) => i.instanceId === "claude-local")?.models;
    expect(models?.some((model) => model.id === "review-model")).toBe(true);
    expect(models?.find((model) => model.id === "review-model")).toMatchObject({
      source: "custom",
      verified: false,
      enabled: false,
    });
  });

  it("setModelEnabled and setModelFavorite update the refreshed summary", async () => {
    const { vm } = viewModel();
    await vm.open();

    await vm.setModelEnabled("claude-local", "claude-opus", true);
    await vm.setModelFavorite("claude-local", "claude-opus", true);

    const opus = vm.summary.instances
      .find((i) => i.instanceId === "claude-local")
      ?.models.find((model) => model.id === "claude-opus");
    expect(opus).toMatchObject({ enabled: true, favorite: true });
  });

  it("surfaces domain errors without mutating state", async () => {
    const { vm } = viewModel();
    await vm.open();

    await expect(vm.addCustomModel("claude-local", "claude sonnet")).rejects.toMatchObject({
      code: "invalid_model_id",
    });
  });
});
