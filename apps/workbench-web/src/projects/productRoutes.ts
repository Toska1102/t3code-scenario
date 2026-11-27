export type ProductRoute =
  | { page: "home" }
  | { page: "projects"; teamId: string | null }
  | { page: "create"; teamId: string | null }
  | { page: "project"; projectId: string }
  | { page: "settings"; projectId: string }
  | { page: "assistant" | "new-workflow"; projectId: string }
  | { page: "workflow" | "dispatch"; projectId: string; workflowId: string; version: string }
  | { page: "task"; projectId: string; taskId: string }
  | { page: "not-found" };

export function routeHref(route: ProductRoute): string {
  const encode = encodeURIComponent;
  switch (route.page) {
    case "home":
      return "#/";
    case "projects":
      return route.teamId === null ? "#/projects" : `#/teams/${encode(route.teamId)}/projects`;
    case "create":
      return `${routeHref({ page: "projects", teamId: route.teamId })}/new`;
    case "project":
      return `#/projects/${encode(route.projectId)}`;
    case "settings":
    case "assistant":
    case "new-workflow":
      return `#/projects/${encode(route.projectId)}/${route.page}`;
    case "workflow":
    case "dispatch":
      return `#/projects/${encode(route.projectId)}/workflows/${encode(route.workflowId)}/versions/${encode(route.version)}${route.page === "dispatch" ? "/dispatch" : ""}`;
    case "task":
      return `#/projects/${encode(route.projectId)}/tasks/${encode(route.taskId)}`;
    case "not-found":
      return "#/not-found";
  }
}

export function parseProductRoute(hash: string): ProductRoute {
  try {
    const path = hash.replace(/^#/, "") || "/";
    if (path === "/") return { page: "home" };
    if (path === "/projects") return { page: "projects", teamId: null };
    if (path === "/projects/new") return { page: "create", teamId: null };
    const segments = path.split("/").slice(1).map(decodeURIComponent);
    if (segments[0] === "teams" && segments[1] && segments[2] === "projects") {
      if (segments.length === 3) return { page: "projects", teamId: segments[1] };
      if (segments.length === 4 && segments[3] === "new")
        return { page: "create", teamId: segments[1] };
    }
    if (segments[0] === "projects" && segments[1]) {
      const projectId = segments[1];
      if (segments.length === 2) return { page: "project", projectId };
      const action = segments[2];
      if (
        segments.length === 3 &&
        (action === "settings" || action === "assistant" || action === "new-workflow")
      )
        return { page: action, projectId };
      if (segments.length === 4 && action === "tasks" && segments[3])
        return { page: "task", projectId, taskId: segments[3] };
      if (action === "workflows" && segments[3] && segments[4] === "versions" && segments[5]) {
        if (segments.length === 6)
          return { page: "workflow", projectId, workflowId: segments[3], version: segments[5] };
        if (segments.length === 7 && segments[6] === "dispatch")
          return { page: "dispatch", projectId, workflowId: segments[3], version: segments[5] };
      }
    }
  } catch {
    return { page: "not-found" };
  }
  return { page: "not-found" };
}
