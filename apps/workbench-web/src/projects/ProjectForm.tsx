import { useState, type FormEvent } from "react";

import type { Project, Team } from "./productClient";
import { productClient } from "./productClient";
import { routeHref } from "./productRoutes";
import { useUnsavedChanges } from "./useUnsavedChanges";

export function ProjectForm({
  project,
  teams,
  initialTeamId,
  onSaved,
}: {
  project?: Project | undefined;
  teams: Team[];
  initialTeamId: string | null;
  onSaved: (project: Project) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [teamId, setTeamId] = useState(project?.teamId ?? initialTeamId ?? "");
  const [directory, setDirectory] = useState(project?.workDirectory ?? "");
  // @effect-diagnostics-next-line cryptoRandomUUID:off -- The browser creates one idempotency key per form submission.
  const [requestId] = useState(() => crypto.randomUUID());
  const [savedId, setSavedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty =
    name !== (project?.name ?? "") ||
    teamId !== (project?.teamId ?? initialTeamId ?? "") ||
    directory !== (project?.workDirectory ?? "");
  useUnsavedChanges(dirty && !savedId);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(undefined);
    let confirmedId = savedId;
    try {
      if (!confirmedId) {
        const input = {
          name: name.trim(),
          teamId: teamId || null,
          workDirectory: directory.trim() || null,
        };
        const result = project
          ? await productClient.updateProject(project.id, input)
          : await productClient.createProject({ requestId, ...input });
        confirmedId = result.id;
        setSavedId(result.id);
      }
      onSaved(await productClient.project(confirmedId));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存失败，请重试。";
      setError(confirmedId ? `项目已保存，但重新读取失败。重试只会重新读取。${message}` : message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="product-settings">
      <form className="product-card product-project-form" onSubmit={save}>
        <h1>{project ? "编辑项目" : "新建项目"}</h1>
        <p className="product-muted">先为这组工作命名。团队和目录可以在需要时再选。</p>
        <fieldset disabled={busy || Boolean(savedId)}>
          <label>
            项目名称 *
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            团队 · 可稍后选择
            <select
              name="teamId"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="">暂不选择团队</option>
              {project?.teamId && !teams.some((team) => team.id === project.teamId) && (
                <option value={project.teamId}>当前团队（暂不可用）</option>
              )}
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            本地工作目录 · 可选
            <input
              name="workDirectory"
              value={directory}
              placeholder="暂未设置，例如 ~/work/recruiting"
              onChange={(event) => setDirectory(event.target.value)}
            />
            <span className="product-field-hint">流程需要读写本地文件时再设置。</span>
          </label>
        </fieldset>
        {error && (
          <p className="product-error" role="alert">
            {error}
          </p>
        )}
        <footer className="product-actions">
          <a
            className="product-button"
            href={routeHref(
              project
                ? { page: "project", projectId: project.id }
                : { page: "projects", teamId: initialTeamId },
            )}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            取消
          </a>
          <button
            className="product-button product-primary"
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy ? "保存中…" : savedId ? "重新读取" : "保存"}
          </button>
        </footer>
      </form>
    </main>
  );
}
