import { describe, expect, it } from "vitest";
import { serviceWith } from "./fixtures.ts";

describe("AgentConnections.getSnapshot", () => {
  it("counts availability as enabled AND authenticated, never enablement alone (R07)", async () => {
    const service = serviceWith();
    const snapshot = await service.getSnapshot();

    expect(snapshot.totalCount).toBe(3);
    expect(snapshot.availableCount).toBe(2);
    const pi = snapshot.instances.find((instance) => instance.provider === "pi");
    expect(pi?.enabled).toBe(true);
    expect(pi?.authState).toBe("unauthenticated");
    expect(pi?.available).toBe(false);
    expect(pi?.statusBadge).toBe("需要认证");
  });

  it("masks secret environment variable values in every response", async () => {
    const service = serviceWith();
    const snapshot = await service.getSnapshot();
    const claude = snapshot.instances.find((instance) => instance.provider === "claude-code");
    const apiKey = claude?.envVars.find((envVar) => envVar.name === "ANTHROPIC_API_KEY");

    expect(apiKey?.secret).toBe(true);
    expect(apiKey?.value).not.toContain("sk-placeholder");
    expect(snapshot).not.toContain("sk-placeholder");
  });

  it("reports the single default instance independently of availability (R13)", async () => {
    const service = serviceWith();
    const snapshot = await service.getSnapshot();

    expect(snapshot.defaultInstanceId).toBe("codex-local");
    expect(snapshot.instances.filter((instance) => instance.isDefault)).toHaveLength(1);
  });
});
