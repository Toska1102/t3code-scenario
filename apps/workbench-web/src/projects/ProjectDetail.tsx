import { useCallback, useState, type FormEvent } from "react";

import { ResourceMessage } from "../product-shell/ProductShell";
import { productClient } from "./productClient";
import type { ProductMounts } from "./productMounts";
import { routeHref } from "./productRoutes";
import { useResource } from "./useResource";

export function ProjectDetail({
  projectId,
  mounts,
  onOrganization,
  onSettings,
}: {
  projectId: string;
  mounts: ProductMounts;
  onOrganization: (teamId: string) => void;
  onSettings: () => void;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [project, teams] = await Promise.all([
        productClient.project(projectId, signal),
        productClient.teams(signal),
      ]);
      return { project, team: teams.teams.find((candidate) => candidate.id === project.teamId) };
    },
    [projectId],
  );
  const { resource, retry } = useResource(load);
  const loadActivity = useCallback(
    async (signal: AbortSignal) => {
      if (!mounts.loadProjectActivity)
        throw new Error("项目任务与工作流服务尚未接入，无法读取列表。");
      return mounts.loadProjectActivity(projectId, signal);
    },
    [projectId, mounts.loadProjectActivity],
  );
  const activity = useResource(loadActivity);
  return (
    <main className="product-workspace">
      <ResourceMessage resource={resource} retry={retry} />
      {resource.status === "ready" && (
        <>
          <div className="product-title-row">
            <div>
              <div className="product-project-title">
                <h1>{resource.value.project.name}</h1>
                <span className="product-muted">项目</span>
              </div>
              <p className="product-muted">团队 · {resource.value.team?.name ?? "尚未选择团队"}</p>
            </div>
            <div className="product-actions">
              {resource.value.project.teamId && (
                <button
                  className="product-button"
                  onClick={() => onOrganization(resource.value.project.teamId!)}
                >
                  组织架构
                </button>
              )}
              <button className="product-button" onClick={onSettings}>
                项目设置
              </button>
            </div>
          </div>
          <div className="product-counts">
            {activity.resource.status === "ready" ? (
              <>
                <span className="product-badge">{activity.resource.value.tasks.length} 个任务</span>
                <span className="product-badge">
                  {activity.resource.value.workflows.length} 个任务工作流
                </span>
              </>
            ) : (
              <span className="product-muted">任务与工作流数量暂不可用</span>
            )}
          </div>
          <section className="product-detail-grid">
            <WorkflowComposer
              projectId={projectId}
              projectName={resource.value.project.name}
              mounts={mounts}
            />
            <section className="product-card" aria-label="项目任务">
              <div className="product-title-row">
                <h2>项目任务</h2>
                {activity.resource.status === "ready" && (
                  <small className="product-pending">
                    待我处理 ·{" "}
                    {activity.resource.value.tasks.filter((task) => task.needsReview).length} 条
                  </small>
                )}
              </div>
              <ResourceMessage resource={activity.resource} retry={activity.retry} />
              {activity.resource.status === "ready" && (
                <ul className="product-task-list">
                  {activity.resource.value.tasks.map((task) => (
                    <li key={task.id}>
                      <div className="product-title-row">
                        <a href={routeHref({ page: "task", projectId, taskId: task.id })}>
                          <small>#{task.id}</small> {task.title}{" "}
                          <span
                            className={`product-badge ${task.needsReview ? "product-pending" : ""}`}
                          >
                            {task.statusLabel}
                          </span>
                        </a>
                        <a
                          className="product-task-action"
                          href={routeHref({ page: "task", projectId, taskId: task.id })}
                        >
                          {task.needsReview ? "处理评审" : "查看结果"} →
                        </a>
                      </div>
                      <a
                        className="product-task-workflow"
                        href={routeHref({
                          page: "workflow",
                          projectId,
                          workflowId: task.workflow.id,
                          version: task.workflow.version,
                        })}
                      >
                        调用工作流 · {task.workflow.name} {task.workflow.version}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {activity.resource.status === "ready" &&
                activity.resource.value.tasks.length === 0 && (
                  <p className="product-muted product-list-empty">暂无项目任务。</p>
                )}
            </section>
          </section>
          <section className="product-workflows" aria-label="任务工作流">
            <h2>任务工作流</h2>
            {activity.resource.status === "loading" && (
              <p role="status" className="product-muted">
                加载中…
              </p>
            )}
            {activity.resource.status === "failed" && (
              <p className="product-muted">工作流列表不可用，可在项目任务区域重试。</p>
            )}
            {activity.resource.status === "ready" && (
              <div className="product-workflow-grid">
                {activity.resource.value.workflows.map((workflow) => {
                  const tasks =
                    activity.resource.status === "ready"
                      ? activity.resource.value.tasks.filter(
                          (task) =>
                            task.workflow.id === workflow.id &&
                            task.workflow.version === workflow.version,
                        )
                      : [];
                  return (
                    <article key={`${workflow.id}:${workflow.version}`} className="product-card">
                      <div className="product-title-row">
                        <h3>{workflow.name}</h3>
                        <span
                          className={`product-badge ${workflow.state === "confirmed" ? "product-confirmed" : ""}`}
                        >
                          {workflow.state === "confirmed"
                            ? `已确认 · ${workflow.version}`
                            : `草稿 · ${workflow.version}`}
                        </span>
                      </div>
                      <p className="product-muted">{workflow.description}</p>
                      <div className="product-actions">
                        <a
                          className="product-button"
                          href={routeHref({
                            page: "workflow",
                            projectId,
                            workflowId: workflow.id,
                            version: workflow.version,
                          })}
                        >
                          {workflow.state === "confirmed" ? "编辑流程" : "继续编辑"}
                        </a>
                        {workflow.state === "confirmed" && (
                          <a
                            className="product-button product-primary"
                            href={routeHref({
                              page: "dispatch",
                              projectId,
                              workflowId: workflow.id,
                              version: workflow.version,
                            })}
                          >
                            用此流程派发
                          </a>
                        )}
                      </div>
                      {tasks.length > 0 && (
                        <div className="product-workflow-tasks">
                          <small>调用此流程 · {tasks.length} 个任务</small>
                          {tasks.map((task) => (
                            <a
                              key={task.id}
                              href={routeHref({ page: "task", projectId, taskId: task.id })}
                            >
                              #{task.id} {task.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {activity.resource.status === "ready" &&
              activity.resource.value.workflows.length === 0 && (
                <p className="product-muted product-list-empty">
                  暂无任务工作流。描述工作内容，创建第一个草稿。
                </p>
              )}
          </section>
        </>
      )}
    </main>
  );
}

function WorkflowComposer({
  projectId,
  projectName,
  mounts,
}: {
  projectId: string;
  projectName: string;
  mounts: ProductMounts;
}) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!mounts.createWorkflow) {
      setError("工作流创建服务尚未接入。描述与附件保留在当前页面，尚未上传或保存。");
      return;
    }
    if (!prompt.trim()) {
      setError("请先描述希望完成的工作。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const workflow = await mounts.createWorkflow({
        projectId,
        prompt: prompt.trim(),
        attachments,
      });
      window.location.hash = routeHref({
        page: "workflow",
        projectId,
        workflowId: workflow.id,
        version: workflow.version,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法创建草稿，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="product-card product-composer" onSubmit={create}>
      <div className="product-title-row">
        <h2>新建任务工作流</h2>
        <a className="product-badge" href={routeHref({ page: "assistant", projectId })}>
          项目助手 · {projectName}
        </a>
      </div>
      <label className="product-composer-label">
        <span className="product-sr-only">工作内容</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          placeholder="描述你希望完成的工作，以及需要团队协作的方式。"
        />
      </label>
      {attachments.length > 0 && (
        <ul className="product-attachments">
          {attachments.map((file, index) => (
            <li key={`${file.name}:${index}`}>
              <span>{file.name}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={`移除附件 ${file.name}`}
                onClick={() =>
                  setAttachments((files) => files.filter((_, candidate) => candidate !== index))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
      )}
      <footer className="product-title-row">
        <label className="product-attachment-control">
          ♧ 添加附件
          <input
            aria-label="添加附件"
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => {
              setAttachments((files) => [...files, ...Array.from(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
        </label>
        <button type="submit" className="product-button product-primary" disabled={busy}>
          {busy ? "创建中…" : "创建工作流草稿 →"}
        </button>
      </footer>
    </form>
  );
}
