/**
 * Persistence port for projects. The parent integration owns the SQLite
 * implementation; the workbench ships the in-memory one for tests.
 */
export interface ProjectStore {
  saveProject(project: ProjectRecord): Promise<void>;
  getProject(id: string): Promise<ProjectRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  /** Maps a client submit key to the workflow draft it already created (story 17). */
  getIdempotentDraft(key: string): Promise<string | null>;
  setIdempotentDraft(key: string, workflowId: string): Promise<void>;
  /** Registers a workflow under its project, in creation order. */
  recordWorkflow(projectId: string, workflowId: string, createdAt: string): Promise<void>;
  workflowsOfProject(projectId: string): Promise<Array<{ workflowId: string; createdAt: string }>>;
}

export interface ProjectRecord {
  id: string;
  teamId: string | null;
  teamName: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export function createMemoryProjectStore(): ProjectStore {
  const projects = new Map<string, ProjectRecord>();
  const idempotency = new Map<string, string>();
  const memberships: Array<{ projectId: string; workflowId: string; createdAt: string }> = [];
  return {
    saveProject: async (project) => {
      projects.set(project.id, project);
    },
    getProject: async (id) => projects.get(id) ?? null,
    listProjects: async () => [...projects.values()],
    getIdempotentDraft: async (key) => idempotency.get(key) ?? null,
    setIdempotentDraft: async (key, workflowId) => {
      idempotency.set(key, workflowId);
    },
    recordWorkflow: async (projectId, workflowId, createdAt) => {
      memberships.push({ projectId, workflowId, createdAt });
    },
    workflowsOfProject: async (projectId) =>
      memberships
        .filter((link) => link.projectId === projectId)
        .map(({ workflowId, createdAt }) => ({ workflowId, createdAt })),
  };
}
