import { useCallback } from "react";

import { ResourceMessage } from "../product-shell/ProductShell";
import { productClient } from "./productClient";
import { routeHref } from "./productRoutes";
import { useResource } from "./useResource";

export function ProjectList({
  teamId,
  onOrganization,
}: {
  teamId: string | null;
  onOrganization: (teamId: string) => void;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [teams, projects] = await Promise.all([
        productClient.teams(signal),
        productClient.projects(teamId === null ? {} : { teamId }, signal),
      ]);
      const team = teams.teams.find((candidate) => candidate.id === teamId);
      if (teamId !== null && !team) throw new Error("此团队不存在，请返回团队首页。");
      return { team, projects: projects.projects };
    },
    [teamId],
  );
  const { resource, retry } = useResource(load);
  return (
    <main className="product-workspace">
      <div className="product-title-row">
        <h1>
          {resource.status === "ready" && resource.value.team
            ? `${resource.value.team.name}的项目`
            : "项目列表"}
        </h1>
        <div className="product-actions">
          {teamId && (
            <button className="product-button" onClick={() => onOrganization(teamId)}>
              组织架构
            </button>
          )}
          <a
            className="product-button product-primary"
            href={routeHref({ page: "create", teamId })}
          >
            新建项目
          </a>
        </div>
      </div>
      <ResourceMessage resource={resource} retry={retry} />
      {resource.status === "ready" && (
        <section className="product-project-grid" aria-label="项目列表">
          {resource.value.projects.map((project) => (
            <article key={project.id} className="product-card">
              <h2>
                <a href={routeHref({ page: "project", projectId: project.id })}>{project.name}</a>
              </h2>
              <p className="product-muted">{project.workDirectory ?? "本地工作目录未设置"}</p>
              <a
                className="product-button"
                href={routeHref({ page: "settings", projectId: project.id })}
              >
                编辑项目
              </a>
            </article>
          ))}
          {resource.value.projects.length === 0 && (
            <p className="product-muted">暂无项目。点击「新建项目」开始。</p>
          )}
        </section>
      )}
    </main>
  );
}
