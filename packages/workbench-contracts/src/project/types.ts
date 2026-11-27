/**
 * Project-level contracts shared by the project page (02.01 workflow catalog,
 * stories 17–18), the HTTP transport and the application layer.
 */

export interface WorkbenchProject {
  id: string;
  /** Null while the project is not attached to a team (story 4). */
  teamId: string | null;
  teamName: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One 流程目录 card (story 18): draft state plus the latest confirmed version
 * and the real dispatch count for that workflow series.
 */
export interface WorkflowCatalogEntry {
  workflowId: string;
  projectId: string;
  name: string;
  description: string;
  status: "draft" | "confirmed";
  /** Latest confirmed version; null while only a draft exists. */
  latestVersionNumber: number | null;
  draftRevision: number;
  dispatchCount: number;
  updatedAt: string;
}

export const DISPATCH_COUNT_UNIT = "次调用";

export function workflowCatalogSummary(entry: WorkflowCatalogEntry): string {
  const version =
    entry.latestVersionNumber !== null ? `已确认 v${entry.latestVersionNumber}` : "草稿";
  return `${entry.name} · ${version} · ${entry.dispatchCount} ${DISPATCH_COUNT_UNIT}`;
}

/**
 * 本次材料 registered at workflow creation (story 17). Only the file identity
 * lives here; reading contents is an adapter concern (ticket 05 dispatch).
 */
export interface WorkflowMaterial {
  id: string;
  /** Bare file name, no path separators. */
  fileName: string;
}

export const MATERIAL_COUNT_CAPTION_UNIT = "份文件";

/** 「已附 6 份文件」 (02.01 新建任务工作流面板). */
export function materialCountCaption(count: number): string {
  return count > 0 ? `已附 ${count} ${MATERIAL_COUNT_CAPTION_UNIT}` : "尚未添加附件";
}

export const PROJECT_NAME_REQUIRED_PROBLEM_CODE = "project.name.required" as const;
export type ProjectProblemCode =
  | typeof PROJECT_NAME_REQUIRED_PROBLEM_CODE
  | "project.notFound"
  | "project.workflow.notFound"
  | "project.material.invalid";

export interface ProjectProblemTarget {
  kind: "project" | "workflow" | "material";
  /** Material id for file-level problems (story 17: failure marks the file). */
  id?: string;
}

export interface ProjectProblem {
  code: ProjectProblemCode;
  message: string;
  target?: ProjectProblemTarget;
}

export type ProjectResult<T> = { ok: true; value: T } | { ok: false; problems: ProjectProblem[] };
