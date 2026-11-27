import {
  AgentConnectionError,
  AgentConnections,
  type AgentInstanceDraft,
} from "../../../../workbench-core/src/agents/application/AgentConnections.ts";

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
export function createAgentConnectionRoutes(service: AgentConnections): WorkbenchRoute[] {
  const json = (status: number, body: unknown): WorkbenchHttpResponse => ({ status, body });
  const snapshot = async () => json(200, await service.getSnapshot());

  const withDraft = (body: unknown): { draft?: AgentInstanceDraft } => {
    if (typeof body !== "object" || body === null || !("draft" in body)) return {};
    const draft = (body as { draft: unknown }).draft as AgentInstanceDraft;
    return { draft };
  };

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
        const { launch, envVars } = request.body as AgentInstanceDraft;
        return json(200, await service.saveInstance(instanceId, { launch, envVars }));
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
        const { enabled } = request.body as { enabled: boolean };
        return json(200, await service.setInstanceEnabled(instanceId, enabled));
      },
    },
    {
      method: "POST",
      pattern: /^\/workbench\/agents\/([^/]+)\/check$/,
      handle: async (request, [instanceId]) =>
        json(200, await service.checkConnection(instanceId, withDraft(request.body))),
    },
    {
      method: "POST",
      pattern: /^\/workbench\/agents\/([^/]+)\/models$/,
      handle: async (request, [instanceId]) => {
        const { modelId } = request.body as { modelId: string };
        return json(200, await service.addCustomModel(instanceId, String(modelId)));
      },
    },
    {
      method: "PATCH",
      pattern: /^\/workbench\/agents\/([^/]+)\/models\/([^/]+)$/,
      handle: async (request, [instanceId, modelId]) => {
        const body = (request.body ?? {}) as { enabled?: boolean; favorite?: boolean };
        const snapshot =
          body.favorite !== undefined
            ? await service.setModelFavorite(instanceId, modelId, body.favorite)
            : await service.setModelEnabled(instanceId, modelId, Boolean(body.enabled));
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
