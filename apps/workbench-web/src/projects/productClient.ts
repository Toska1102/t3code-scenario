export interface Team {
  id: string;
  name: string;
  description: string | null;
}

export interface Project {
  id: string;
  teamId: string | null;
  name: string;
  workDirectory: string | null;
}

export interface ProductSummary {
  teams: number;
  projects: number;
  tasks: number;
}

export async function readResponse<Body>(response: Response): Promise<Body> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "http_error";
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : response.status === 401
          ? "登录已失效，请重新连接工作台。"
          : response.status === 403
            ? "当前会话没有执行此操作的权限。"
            : response.status === 404
              ? "此资源不存在，或服务尚未接入。"
              : `请求失败（HTTP ${response.status}），请重试。`;
    throw Object.assign(new Error(message), { status: response.status, code });
  }
  if (body === null) throw new Error("服务返回了无法读取的数据，请重试。");
  return body as Body;
}

export function createProductClient(transport: typeof fetch = (...args) => fetch(...args)) {
  async function request<Body>(path: string, options?: RequestInit): Promise<Body> {
    return readResponse<Body>(
      await transport(`/api/workbench${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
      }),
    );
  }
  return {
    teams: (signal?: AbortSignal) =>
      request<{ teams: Team[] }>("/teams", { signal: signal ?? null }),
    projects: (scope: { teamId?: string; unassigned?: boolean } = {}, signal?: AbortSignal) => {
      const query =
        scope.teamId !== undefined
          ? `?teamId=${encodeURIComponent(scope.teamId)}`
          : scope.unassigned
            ? "?unassigned=true"
            : "";
      return request<{ projects: Project[] }>(`/projects${query}`, { signal: signal ?? null });
    },
    project: (id: string, signal?: AbortSignal) =>
      request<Project>(`/projects/${encodeURIComponent(id)}`, { signal: signal ?? null }),
    summary: (signal?: AbortSignal) =>
      request<ProductSummary>("/summary", { signal: signal ?? null }),
    createProject: (input: Omit<Project, "id"> & { requestId: string }) =>
      request<Project>("/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    updateProject: (id: string, input: Omit<Project, "id">) =>
      request<Project>(`/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    createTeam: (input: { requestId: string; name: string; description: string | null }) =>
      request<Team>("/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    organization: (teamId: string, signal?: AbortSignal) =>
      request<StoredOrganization>(`/teams/${encodeURIComponent(teamId)}/organization`, {
        signal: signal ?? null,
      }),
    saveOrganization: (teamId: string, input: SaveOrganizationPayload) =>
      request<{ revision: number }>(`/teams/${encodeURIComponent(teamId)}/organization`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  };
}

export const productClient = createProductClient();
import type { SaveOrganizationPayload } from "../../features/teams/organization";
import type { StoredOrganization } from "../../../../packages/workbench-core/src/teams/organization/SaveOrganization";
