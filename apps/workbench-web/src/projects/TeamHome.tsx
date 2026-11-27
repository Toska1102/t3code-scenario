import { useCallback } from "react";

import { ResourceMessage } from "../product-shell/ProductShell";
import { productClient, type Project } from "./productClient";
import { routeHref } from "./productRoutes";
import { useResource } from "./useResource";

export function TeamHome({
  onOrganization,
  onCreateTeam,
}: {
  onOrganization: (teamId: string) => void;
  onCreateTeam: () => void;
}) {
  const load = useCallback(async (signal: AbortSignal) => {
    const [teams, projects, summary] = await Promise.all([
      productClient.teams(signal),
      productClient.projects({}, signal),
      productClient.summary(signal),
    ]);
    return { teams: teams.teams, projects: projects.projects, summary };
  }, []);
  const { resource, retry } = useResource(load);
  return (
    <main className="product-home">
      <div className="product-title-row">
        <h1>团队总览</h1>
        <button className="product-button" onClick={onCreateTeam}>
          新建团队
        </button>
      </div>
      <ResourceMessage resource={resource} retry={retry} />
      {resource.status === "ready" && (
        <>
          <dl className="product-stats">
            <div>
              <dd>{resource.value.summary.teams}</dd>
              <dt>团队</dt>
            </div>
            <div>
              <dd>
                <a href={routeHref({ page: "projects", teamId: null })}>
                  {resource.value.summary.projects}
                </a>
              </dd>
              <dt>项目</dt>
            </div>
            <div>
              <dd>{resource.value.summary.tasks}</dd>
              <dt>项目任务</dt>
            </div>
          </dl>
          <section className="product-team-grid" aria-label="团队列表">
            {resource.value.teams.map((team) => {
              const projects = resource.value.projects.filter(
                (project) => project.teamId === team.id,
              );
              return (
                <article className="product-card product-team-card" key={team.id}>
                  <div className="product-title-row">
                    <h2>
                      <span className="product-team-icon" aria-hidden="true">
                        ♧
                      </span>
                      {team.name}
                    </h2>
                    <small>{projects.length} 个项目</small>
                  </div>
                  <p className="product-muted">{team.description || "暂无团队说明。"}</p>
                  <ProjectLinks projects={projects} />
                  <footer className="product-actions">
                    <a
                      className="product-button product-primary"
                      href={routeHref({ page: "projects", teamId: team.id })}
                    >
                      查看项目 →
                    </a>
                    <button className="product-button" onClick={() => onOrganization(team.id)}>
                      组织架构
                    </button>
                  </footer>
                </article>
              );
            })}
          </section>
          {resource.value.teams.length === 0 && (
            <section className="product-card product-empty">
              <h2>还没有团队</h2>
              <p>创建团队来组织项目，也可以先创建项目，稍后再选择团队。</p>
              <a
                className="product-button product-primary"
                href={routeHref({ page: "create", teamId: null })}
              >
                新建项目
              </a>
            </section>
          )}
          {resource.value.projects.some((project) => project.teamId === null) && (
            <section className="product-card product-unassigned">
              <h2>未分配团队的项目</h2>
              <ProjectLinks
                projects={resource.value.projects.filter((project) => project.teamId === null)}
              />
            </section>
          )}
          <a className="product-all-projects" href={routeHref({ page: "projects", teamId: null })}>
            查看全部项目 →
          </a>
        </>
      )}
    </main>
  );
}

function ProjectLinks({ projects }: { projects: Project[] }) {
  return projects.length ? (
    <ul className="product-project-links">
      {projects.map((project) => (
        <li key={project.id}>
          <a href={routeHref({ page: "project", projectId: project.id })}>
            <span aria-hidden="true">▱</span>
            {project.name}
          </a>
        </li>
      ))}
    </ul>
  ) : (
    <p className="product-project-empty product-muted">暂无项目。</p>
  );
}
