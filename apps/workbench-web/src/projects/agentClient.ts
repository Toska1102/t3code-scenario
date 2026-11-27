import type { AgentConnectionsGateway } from "../../../../packages/workbench-core/src/agents/application/AgentConnectionsGateway";
import { readResponse } from "./productClient";

export function createBrowserAgentGateway(
  transport: typeof fetch = (...args) => fetch(...args),
): AgentConnectionsGateway {
  async function call<Body>(method: string, path = "", body?: unknown): Promise<Body> {
    return readResponse<Body>(
      await transport(`/api/workbench/agents${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  }
  const instancePath = (instanceId: string) => `/${encodeURIComponent(instanceId)}`;
  return {
    getSnapshot: () => call("GET"),
    saveInstance: (id, draft) => call("PATCH", instancePath(id), draft),
    setInstanceEnabled: (id, enabled) => call("POST", `${instancePath(id)}/enabled`, { enabled }),
    setDefaultInstance: (id) => call("POST", `${instancePath(id)}/default`),
    checkConnection: (id, input) => call("POST", `${instancePath(id)}/check`, input ?? {}),
    addCustomModel: (id, modelId) => call("POST", `${instancePath(id)}/models`, { modelId }),
    setModelEnabled: (id, modelId, enabled) =>
      call("PATCH", `${instancePath(id)}/models/${encodeURIComponent(modelId)}`, { enabled }),
    setModelFavorite: (id, modelId, favorite) =>
      call("PATCH", `${instancePath(id)}/models/${encodeURIComponent(modelId)}`, { favorite }),
  };
}

export const browserAgentGateway = createBrowserAgentGateway();
