import {
  AgentConnectionError,
  type AgentInstanceDraft,
} from "../../../../workbench-core/src/agents/application/AgentConnections.ts";
import type { AgentConnectionsGateway } from "../../../../workbench-core/src/agents/application/AgentConnectionsGateway.ts";

export interface WorkbenchHttpRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface WorkbenchHttpResponse {
  status: number;
  body: unknown;
}

export interface WorkbenchRoute {
  method: string;
  pattern: RegExp;
  handle(request: WorkbenchHttpRequest, params: string[]): Promise<WorkbenchHttpResponse>;
}

/**
 * Framework-neutral route table for the Agent connection dialog. Ticket 01's
 * server composition mounts these under its HTTP adapter; responses never
 * contain secret values because the core snapshot is redacted at the source.
 */
const invalidRequest = (field?: string): WorkbenchHttpResponse => ({
  status: 422,
  body: { error: { code: "invalid_request", ...(field ? { field } : {}) } },
});

function draftFromBody(body: unknown): { draft?: AgentInstanceDraft } | undefined {
  if (typeof body !== "object" || body === null || !("draft" in body)) return {};
  const draft = (body as { draft?: unknown }).draft;
  if (draft === undefined) return {};
  if (typeof draft !== "object" || draft === null) return undefined;
  const { launch, envVars } = draft as { launch?: unknown; envVars?: unknown };
  if (
    typeof launch !== "object" ||
    launch === null ||
    Array.isArray(launch) ||
    !Array.isArray(envVars)
  )
    return undefined;
  const fields = new Set([
    "executable",
    "args",
    "configDir",
    "compressionThreshold",
    "idleCompression",
  ]);
  if (Object.entries(launch).some(([key, value]) => !fields.has(key) || typeof value !== "string"))
    return undefined;
  if (
    !envVars.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.name === "string" &&
        typeof entry.value === "string" &&
        typeof entry.secret === "boolean",
    )
  )
    return undefined;
  return { draft: { launch, envVars } };
}

function booleanFromBody(body: unknown, field: string): boolean | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "boolean" ? value : undefined;
}

export function createAgentConnectionRoutes(service: AgentConnectionsGateway): WorkbenchRoute[] {
  const json = (status: number, body: unknown): WorkbenchHttpResponse => ({ status, body });
  const snapshot = async () => json(200, await service.getSnapshot());

  return [
    {
      method: "GET",
      pattern: /^\/workbench\/agents$/,
      handle: () => snapshot(),
    },
    {
      method: "PATCH",
      pattern: /^\/workbench\/agents\/([^/]+)$/,
      handle: async (request, [instanceId]) => {
        const { launch, envVars } = (request.body ?? {}) as {
          launch?: unknown;
          envVars?: unknown;
        };
        if (typeof launch !== "object" || launch === null || !Array.isArray(envVars)) {
          return invalidRequest(Array.isArray(envVars) ? undefined : "envVars");
        }
        return json(
          200,
          await service.saveInstance(instanceId, {
            launch: launch as AgentInstanceDraft["launch"],
            envVars: envVars as AgentInstanceDraft["envVars"],
          }),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/workbench\/agents\/([^/]+)\/default$/,
      handle: async (_request, [instanceId]) =>
        json(200, await service.setDefaultInstance(instanceId)),
    },
    {
      method: "POST",
      pattern: /^\/workbench\/agents\/([^/]+)\/enabled$/,
      handle: async (request, [instanceId]) => {
        const enabled = booleanFromBody(request.body, "enabled");
        if (enabled === undefined) return invalidRequest("enabled");
        return json(200, await service.setInstanceEnabled(instanceId, enabled));
      },
    },
    {
      method: "POST",
      pattern: /^\/workbench\/agents\/([^/]+)\/check$/,
      handle: async (request, [instanceId]) => {
        const input = draftFromBody(request.body);
        if (input === undefined) return invalidRequest("draft");
        return json(200, await service.checkConnection(instanceId, input));
      },
    },
    {
      method: "POST",
      pattern: /^\/workbench\/agents\/([^/]+)\/models$/,
      handle: async (request, [instanceId]) => {
        const modelId = (request.body as { modelId?: unknown } | undefined)?.modelId;
        if (typeof modelId !== "string") return invalidRequest("modelId");
        return json(200, await service.addCustomModel(instanceId, modelId));
      },
    },
    {
      method: "PATCH",
      pattern: /^\/workbench\/agents\/([^/]+)\/models\/([^/]+)$/,
      handle: async (request, [instanceId, modelId]) => {
        const enabled = booleanFromBody(request.body, "enabled");
        const favorite = booleanFromBody(request.body, "favorite");
        if (enabled === undefined && favorite === undefined) return invalidRequest();
        const snapshot =
          favorite !== undefined
            ? await service.setModelFavorite(instanceId, modelId, favorite)
            : await service.setModelEnabled(instanceId, modelId, enabled);
        return json(200, snapshot);
      },
    },
  ];
}

export async function handleAgentConnectionRequest(
  routes: WorkbenchRoute[],
  request: WorkbenchHttpRequest,
): Promise<WorkbenchHttpResponse> {
  for (const route of routes) {
    const match = route.pattern.exec(request.path);
    if (match && route.method === request.method) {
      try {
        return await route.handle(request, match.slice(1));
      } catch (error) {
        return toErrorResponse(error);
      }
    }
  }
  return { status: 404, body: { error: { code: "not_found" } } };
}

function toErrorResponse(error: unknown): WorkbenchHttpResponse {
  if (error instanceof AgentConnectionError) {
    const status = error.code === "instance_not_found" ? 404 : 422;
    return {
      status,
      body: { error: { code: error.code, ...(error.field ? { field: error.field } : {}) } },
    };
  }
  throw error;
}

export interface AgentConnectionsTransport {
  (request: WorkbenchHttpRequest): Promise<WorkbenchHttpResponse>;
}

/**
 * Client-side implementation of the dialog's gateway port over any HTTP
 * transport. Server error contracts rethrow as AgentConnectionError so the
 * dialog handles the same error codes the service defines.
 */
export function createAgentConnectionsGateway(
  transport: AgentConnectionsTransport,
): AgentConnectionsGateway {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await transport({ method, path, body });
    if (response.status >= 400) {
      const error = (response.body as { error?: { code?: string; field?: string } }).error;
      throw new AgentConnectionError(
        (error?.code ?? "invalid_request") as AgentConnectionError["code"],
        error?.field,
      );
    }
    return response.body as T;
  };
  return {
    getSnapshot: () => call("GET", "/workbench/agents"),
    saveInstance: (instanceId, draft) =>
      call("PATCH", `/workbench/agents/${encodeURIComponent(instanceId)}`, draft),
    setInstanceEnabled: (instanceId, enabled) =>
      call("POST", `/workbench/agents/${encodeURIComponent(instanceId)}/enabled`, { enabled }),
    setDefaultInstance: (instanceId) =>
      call("POST", `/workbench/agents/${encodeURIComponent(instanceId)}/default`),
    checkConnection: (instanceId, input) =>
      call("POST", `/workbench/agents/${encodeURIComponent(instanceId)}/check`, input ?? {}),
    addCustomModel: (instanceId, modelId) =>
      call("POST", `/workbench/agents/${encodeURIComponent(instanceId)}/models`, { modelId }),
    setModelEnabled: (instanceId, modelId, enabled) =>
      call(
        "PATCH",
        `/workbench/agents/${encodeURIComponent(instanceId)}/models/${encodeURIComponent(modelId)}`,
        { enabled },
      ),
    setModelFavorite: (instanceId, modelId, favorite) =>
      call(
        "PATCH",
        `/workbench/agents/${encodeURIComponent(instanceId)}/models/${encodeURIComponent(modelId)}`,
        { favorite },
      ),
  };
}
