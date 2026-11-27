import {
  materialCountCaption,
  type ProjectProblem,
  type WorkflowMaterial,
} from "../../../../packages/workbench-contracts/src/project/types.ts";
import type { WorkflowDraft } from "../../../../packages/workbench-contracts/src/workflow/types.ts";

export interface CreateWorkflowPanelOperations {
  /** Server-side creation; idempotent on the panel's submit key (story 17). */
  createWorkflowDraft(input: {
    name?: string;
    description?: string;
    materials: WorkflowMaterial[];
  }): Promise<ProjectResultLike>;
}

/** Structural subset of ProjectResult<WorkflowDraft>; keeps the panel decoupled from the core import. */
type ProjectResultLike =
  | { ok: true; value: WorkflowDraft }
  | { ok: false; problems: ProjectProblem[] };

export interface CreateWorkflowPanelState {
  description: string;
  materials: WorkflowMaterial[];
  /** Per-file problem messages, keyed by material id (story 17: failure marks the file). */
  fileErrors: Record<string, string>;
  submitting: boolean;
  lastError: string | null;
}

export interface CreateWorkflowPanelCallbacks {
  onCreated(draft: WorkflowDraft): void;
}

/**
 * 02.01 新建任务工作流 module (story 17). Creation only ever enters a draft;
 * a failed submit marks the offending file and keeps every other input, and
 * a repeated submit recovers the same draft through the stable submit key.
 */
export class CreateWorkflowPanelController {
  private state: CreateWorkflowPanelState = {
    description: "",
    materials: [],
    fileErrors: {},
    submitting: false,
    lastError: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly operations: CreateWorkflowPanelOperations;
  private readonly callbacks: CreateWorkflowPanelCallbacks;
  private readonly submitKeyValue: string;
  private fileCounter = 0;
  private createdDraft: WorkflowDraft | null = null;

  private static panelCounter = 0;

  constructor(operations: CreateWorkflowPanelOperations, callbacks: CreateWorkflowPanelCallbacks) {
    this.operations = operations;
    this.callbacks = callbacks;
    this.submitKeyValue = `create-workflow-panel-${(CreateWorkflowPanelController.panelCounter += 1)}`;
  }

  getState(): CreateWorkflowPanelState {
    return this.state;
  }

  submitKey(): string {
    return this.submitKeyValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<CreateWorkflowPanelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  setDescription(description: string): void {
    this.set({ description });
  }

  /** 「已附 6 份文件」/「尚未添加附件」 per the 02.01 design. */
  caption(): string {
    return materialCountCaption(this.state.materials.length);
  }

  addFile(fileName: string): void {
    const material: WorkflowMaterial = { id: `m-${(this.fileCounter += 1)}`, fileName };
    const error = this.fileNameProblem(fileName);
    this.set({
      materials: [...this.state.materials, material],
      fileErrors: error
        ? { ...this.state.fileErrors, [material.id]: error }
        : this.state.fileErrors,
    });
  }

  /** Swap one attachment in place; a replacement re-validates only that file. */
  replaceFile(id: string, fileName: string): void {
    const error = this.fileNameProblem(fileName);
    const fileErrors = { ...this.state.fileErrors };
    if (error) fileErrors[id] = error;
    else delete fileErrors[id];
    this.set({
      materials: this.state.materials.map((material) =>
        material.id === id ? { ...material, fileName } : material,
      ),
      fileErrors,
    });
  }

  removeFile(id: string): void {
    const fileErrors = { ...this.state.fileErrors };
    delete fileErrors[id];
    this.set({
      materials: this.state.materials.filter((material) => material.id !== id),
      fileErrors,
    });
  }

  fileError(id: string): string | null {
    return this.state.fileErrors[id] ?? null;
  }

  private fileNameProblem(fileName: string): string | null {
    const trimmed = fileName.trim();
    if (!trimmed) return "附件的文件名不能为空。";
    if (trimmed.includes("/") || trimmed.includes("\\")) return `「${trimmed}」不是有效的文件名。`;
    if (this.state.materials.some((material) => material.fileName.trim() === trimmed))
      return `「${trimmed}」重复添加。`;
    return null;
  }

  /** Maps server per-file problems back onto the submitted material ids. */
  applyProblems(problems: ProjectProblem[]): void {
    const fileErrors = { ...this.state.fileErrors };
    const others: string[] = [];
    for (const problem of problems) {
      if (problem.target?.kind === "material" && problem.target.id)
        fileErrors[problem.target.id] = problem.message;
      else others.push(problem.message);
    }
    this.set({ fileErrors, lastError: others.join(" ") || null });
  }

  async submit(): Promise<void> {
    // Already created through this panel: creation happened exactly once.
    if (this.createdDraft || this.state.submitting) return;
    this.set({ submitting: true, lastError: null });
    const result = await this.operations.createWorkflowDraft({
      description: this.state.description,
      materials: this.state.materials,
    });
    if (!result.ok) {
      this.set({ submitting: false });
      this.applyProblems(result.problems);
      return;
    }
    this.createdDraft = result.value;
    this.set({ submitting: false });
    this.callbacks.onCreated(result.value);
  }
}
