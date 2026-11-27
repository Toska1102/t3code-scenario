import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ProjectRecord, ProjectStore } from "./store.ts";

interface PersistedState {
  projects: ProjectRecord[];
  idempotency: Record<string, string>;
  memberships: Array<{ projectId: string; workflowId: string; createdAt: string }>;
}

/**
 * JSON-file persistence for projects: one state file, rewritten atomically.
 * Volume is small (projects, submit keys, workflow links), so a single file
 * beats a per-record layout here.
 */
export async function createFileProjectStore(stateDir: string): Promise<ProjectStore> {
  if (!NodeFS.existsSync(stateDir)) NodeFS.mkdirSync(stateDir, { recursive: true });
  const path = NodePath.join(stateDir, "projects.json");

  function read(): PersistedState {
    if (!NodeFS.existsSync(path)) return { projects: [], idempotency: {}, memberships: [] };
    return JSON.parse(NodeFS.readFileSync(path, "utf8")) as PersistedState;
  }

  function write(state: PersistedState): void {
    const tmp = `${path}.tmp`;
    NodeFS.writeFileSync(tmp, JSON.stringify(state, null, "\t"), "utf8");
    NodeFS.renameSync(tmp, path);
  }

  return {
    saveProject: async (project) => {
      const state = read();
      const index = state.projects.findIndex((candidate) => candidate.id === project.id);
      if (index >= 0) state.projects[index] = project;
      else state.projects.push(project);
      write(state);
    },
    getProject: async (id) => read().projects.find((candidate) => candidate.id === id) ?? null,
    listProjects: async () => read().projects,
    getIdempotentDraft: async (key) => read().idempotency[key] ?? null,
    setIdempotentDraft: async (key, workflowId) => {
      const state = read();
      state.idempotency[key] = workflowId;
      write(state);
    },
    recordWorkflow: async (projectId, workflowId, createdAt) => {
      const state = read();
      state.memberships.push({ projectId, workflowId, createdAt });
      write(state);
    },
    workflowsOfProject: async (projectId) =>
      read()
        .memberships.filter((link) => link.projectId === projectId)
        .map(({ workflowId, createdAt }) => ({ workflowId, createdAt })),
  };
}
