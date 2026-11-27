import { useCallback } from "react";

import { ResourceMessage } from "../product-shell/ProductShell";
import { productClient } from "./productClient";
import { ProjectForm } from "./ProjectForm";
import { routeHref } from "./productRoutes";
import { useResource } from "./useResource";

export function ProjectEditor({
  projectId,
  teamId,
}: {
  projectId?: string;
  teamId: string | null;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [teams, project] = await Promise.all([
        productClient.teams(signal),
        projectId ? productClient.project(projectId, signal) : undefined,
      ]);
      if (!projectId && teamId && !teams.teams.some((team) => team.id === teamId))
        throw new Error("此团队不存在，请返回团队首页。");
      return { teams: teams.teams, project };
    },
    [projectId, teamId],
  );
  const { resource, retry } = useResource(load);
  return resource.status === "ready" ? (
    <ProjectForm
      project={resource.value.project}
      teams={resource.value.teams}
      initialTeamId={teamId}
      onSaved={(project) => {
        window.location.hash = routeHref({ page: "project", projectId: project.id });
      }}
    />
  ) : (
    <main className="product-settings">
      <ResourceMessage resource={resource} retry={retry} />
    </main>
  );
}
