import {
  type TeamGraphSnapshot,
  type WorkflowDraft,
  type WorkflowProblem,
  type WorkflowResult,
  type WorkflowStep,
  type WorkflowStepConfig,
  type WorkflowVersionRecord,
  edgeId,
} from "../../../../packages/workbench-contracts/src/workflow/types.ts";
import {
  autoLayout,
  canAddEdge,
  deleteStepImpact,
  type DependencyEdge,
  findGraphProblems,
  removeStep,
} from "../../../../packages/workbench-core/src/workflow/graph.ts";
import { candidatePool } from "../../../../packages/workbench-core/src/workflow/members.ts";
import { confirmProblems } from "../../../../packages/workbench-core/src/workflow/validation.ts";

export interface WorkflowEditorOperations {
  saveDraft(draft: WorkflowDraft): Promise<WorkflowResult<WorkflowDraft>>;
  confirmDraft(draft: WorkflowDraft): Promise<WorkflowResult<WorkflowVersionRecord>>;
  generateSteps(draft: WorkflowDraft): Promise<WorkflowResult<string[]>>;
  listHistory(workflowId: string): Promise<WorkflowVersionRecord[]>;
  startRevision(workflowId: string, versionNumber: number): Promise<WorkflowDraft>;
  /** Reload the persisted draft after the service mutated it (e.g. after generate). */
  loadDraft?(id: string): Promise<WorkflowDraft | null>;
}

export type EditorStatus = "idle" | "saving" | "confirming" | "generating";

export interface WorkflowEditorState {
  draft: WorkflowDraft;
  teamGraph: TeamGraphSnapshot;
  /** Live confirm problems (story 26 gates); derived, never stale. */
  problems: WorkflowProblem[];
  status: EditorStatus;
  /** Failure message from the last failed operation; the draft is preserved. */
  lastError: string | null;
  dirty: boolean;
  versions: WorkflowVersionRecord[];
  historyOpen: boolean;
  fieldsOpen: boolean;
  selectedStepId: string | null;
  selectedEdge: DependencyEdge | null;
  zoom: number;
  /** Set after a successful confirm; the footer uses it for 继续首次派发. */
  confirmedVersion: WorkflowVersionRecord | null;
}

export interface WorkflowEditorCallbacks {
  /** Delete confirmations and unsaved-changes guards route through here. */
  confirm(message: string): boolean | Promise<boolean>;
  onBackToProject?(): void;
  onContinueDispatch?(draft: WorkflowDraft, version: WorkflowVersionRecord | null): void;
  onOpenAgentConnections?(): void;
}

function initialState(
  draft: WorkflowDraft,
  teamGraph: TeamGraphSnapshot,
  versions: WorkflowVersionRecord[],
): WorkflowEditorState {
  return {
    draft,
    teamGraph,
    problems: confirmProblems(draft, teamGraph),
    status: "idle",
    lastError: null,
    dirty: false,
    versions,
    historyOpen: false,
    fieldsOpen: false,
    selectedStepId: draft.steps[0]?.id ?? null,
    selectedEdge: null,
    zoom: 1,
    confirmedVersion: null,
  };
}

/**
 * Pure-ish state machine behind the 03.01 editor view. All mutation goes
 * through actions; the view re-renders from `getState()`. Confirm gates are
 * the same `confirmProblems` the service runs, so the UI can never offer a
 * confirm the domain would reject.
 */
export class WorkflowEditorController {
  private state: WorkflowEditorState;
  private stepCounter = 0;
  private readonly listeners = new Set<() => void>();

  private readonly operations: WorkflowEditorOperations;
  private readonly callbacks: WorkflowEditorCallbacks;

  constructor(
    operations: WorkflowEditorOperations,
    callbacks: WorkflowEditorCallbacks,
    draft: WorkflowDraft,
    teamGraph: TeamGraphSnapshot,
    versions: WorkflowVersionRecord[] = [],
  ) {
    this.operations = operations;
    this.callbacks = callbacks;
    this.state = initialState(draft, teamGraph, versions);
  }

  getState(): WorkflowEditorState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<WorkflowEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setDraft(patch: Partial<WorkflowDraft>): void {
    const draft = { ...this.state.draft, ...patch };
    this.set({ draft, dirty: true, problems: confirmProblems(draft, this.state.teamGraph) });
  }

  private async guard(message: string): Promise<boolean> {
    return Boolean(await this.callbacks.confirm(message));
  }

  // ── workflow-level editing ────────────────────────────────────────────

  setName(name: string): void {
    this.setDraft({ name });
  }

  setDescription(description: string): void {
    this.setDraft({ description });
  }

  setDeliverable(deliverable: string): void {
    this.setDraft({ deliverable });
  }

  setInputFields(inputFields: WorkflowDraft["inputFields"]): void {
    this.setDraft({ inputFields });
  }

  toggleFieldsOpen(): void {
    this.set({ fieldsOpen: !this.state.fieldsOpen });
  }

  /** Story 21: removing an input field warns with the affected steps first. */
  async removeInputField(fieldKey: string): Promise<void> {
    const affected = this.state.draft.steps
      .filter((step) =>
        step.config.inputRefs.some((ref) => ref.kind === "dispatch" && ref.fieldKey === fieldKey),
      )
      .map((step) => step.title);
    const label =
      this.state.draft.inputFields.find((field) => field.key === fieldKey)?.label ?? fieldKey;
    if (affected.length) {
      const proceed = await this.guard(
        `删除字段「${label}」会影响步骤：${affected.join("、")}。确定删除吗？`,
      );
      if (!proceed) return;
    }
    this.setDraft({
      inputFields: this.state.draft.inputFields.filter((field) => field.key !== fieldKey),
      steps: this.state.draft.steps.map((step) => ({
        ...step,
        config: {
          ...step.config,
          inputRefs: step.config.inputRefs.filter(
            (ref) => !(ref.kind === "dispatch" && ref.fieldKey === fieldKey),
          ),
        },
      })),
    });
  }

  // ── members (story 22) ────────────────────────────────────────────────

  /** Selected members plus their auto-included ancestors; ancestors are view-only. */
  memberChips(): Array<{
    id: string;
    name: string;
    agentLabel: string;
    selected: boolean;
    autoIncluded: boolean;
  }> {
    const { teamGraph, draft } = this.state;
    const pool = candidatePool(teamGraph, draft.memberIds);
    return pool.map((entry) => ({
      id: entry.node.id,
      name: entry.node.name,
      agentLabel: entry.node.binding?.kind === "agent" ? entry.node.binding.agentName : "",
      selected: !entry.autoIncluded,
      autoIncluded: entry.autoIncluded,
    }));
  }

  toggleMember(nodeId: string): void {
    const pool = candidatePool(this.state.teamGraph, this.state.draft.memberIds);
    const entry = pool.find((candidate) => candidate.node.id === nodeId);
    if (!entry || entry.autoIncluded) return; // ancestors are candidates only; they cannot be deselected here
    const selected = this.state.draft.memberIds.includes(nodeId)
      ? this.state.draft.memberIds.filter((id) => id !== nodeId)
      : [...this.state.draft.memberIds, nodeId];
    this.setDraft({ memberIds: selected });
  }

  /** “已选 OD、招聘，上级 HR 总管 自动带入。” */
  membersCaption(): string {
    const pool = this.memberChips();
    const selected = pool.filter((chip) => chip.selected).map((chip) => chip.name);
    const auto = pool.filter((chip) => chip.autoIncluded).map((chip) => chip.name);
    if (!selected.length) return "尚未选择参与成员。";
    const autoPart = auto.length ? `，上级 ${auto.join("、")} 自动带入` : "";
    return `已选 ${selected.join("、")}${autoPart}。`;
  }

  // ── steps (stories 24/25) ─────────────────────────────────────────────

  addStep(): void {
    const steps = this.state.draft.steps;
    const last = steps[steps.length - 1];
    const ownerId = this.state.draft.memberIds[0] ?? this.state.teamGraph.nodes[0]?.id ?? "";
    const step: WorkflowStep = {
      id: `s-${(this.stepCounter += 1)}`,
      title: "新步骤",
      ownerId,
      mode: "execution",
      dependsOn: last ? [last.id] : [],
      position: last ? { x: last.position.x + 260, y: last.position.y } : { x: 0, y: 140 },
      config: this.defaultStepConfig(ownerId),
    };
    this.setDraft({ steps: [...steps, step] });
    this.set({ selectedStepId: step.id, selectedEdge: null });
  }

  private defaultStepConfig(ownerId: string): WorkflowStepConfig {
    const node = this.state.teamGraph.nodes.find((candidate) => candidate.id === ownerId);
    return {
      prompt: "",
      inputRefs: [],
      outputKey: "",
      outputLabel: "",
      tools: "读取文件",
      tokens: Math.min(6000, node?.tokens ?? 6000),
      model: node?.model ?? "Claude Sonnet",
    };
  }

  selectStep(stepId: string | null): void {
    this.set({ selectedStepId: stepId, selectedEdge: null });
  }

  updateStep(stepId: string, patch: Partial<WorkflowStep>): void {
    this.setDraft({
      steps: this.state.draft.steps.map((step) =>
        step.id === stepId ? { ...step, ...patch } : step,
      ),
    });
  }

  updateStepConfig(stepId: string, patch: Partial<WorkflowStepConfig>): void {
    this.setDraft({
      steps: this.state.draft.steps.map((step) =>
        step.id === stepId ? { ...step, config: { ...step.config, ...patch } } : step,
      ),
    });
  }

  /** Story 24: deletion shows its impact before removing. */
  async deleteStep(stepId: string): Promise<void> {
    const impact = deleteStepImpact(this.state.draft.steps, stepId);
    const lines = [
      impact.directDependentTitles.length
        ? `直接依赖它的步骤：${impact.directDependentTitles.join("、")}`
        : null,
      impact.inputStepTitles.length
        ? `读取它输出的步骤：${impact.inputStepTitles.join("、")}`
        : null,
    ].filter(Boolean);
    const proceed = await this.guard(
      lines.length
        ? `删除「${this.stepTitle(stepId)}」将影响：${lines.join("；")}。确定删除吗？`
        : `确定删除「${this.stepTitle(stepId)}」吗？`,
    );
    if (!proceed) return;
    this.setDraft({ steps: removeStep(this.state.draft.steps, stepId) });
    this.set({ selectedStepId: null });
  }

  stepTitle(stepId: string): string {
    return this.state.draft.steps.find((step) => step.id === stepId)?.title ?? stepId;
  }

  /** Returns a blocking message when the edge is rejected; null when added. */
  connectSteps(from: string, to: string): string | null {
    const problem = canAddEdge(this.state.draft.steps, from, to);
    if (problem) return problem.message;
    this.setDraft({
      steps: this.state.draft.steps.map((step) =>
        step.id === to ? { ...step, dependsOn: [...step.dependsOn, from] } : step,
      ),
    });
    return null;
  }

  selectEdge(edge: DependencyEdge | null): void {
    this.set({ selectedEdge: edge, selectedStepId: null });
  }

  deleteSelectedEdge(): void {
    const edge = this.state.selectedEdge;
    if (!edge) return;
    this.setDraft({
      steps: this.state.draft.steps.map((step) =>
        step.id === edge.to
          ? { ...step, dependsOn: step.dependsOn.filter((dependency) => dependency !== edge.from) }
          : step,
      ),
    });
    this.set({ selectedEdge: null });
  }

  selectedEdgeId(): string | null {
    return this.state.selectedEdge
      ? edgeId(this.state.selectedEdge.from, this.state.selectedEdge.to)
      : null;
  }

  autoLayoutSteps(): void {
    this.setDraft({ steps: autoLayout(this.state.draft.steps) });
  }

  moveStep(stepId: string, position: { x: number; y: number }): void {
    this.setDraft({
      steps: this.state.draft.steps.map((step) =>
        step.id === stepId ? { ...step, position } : step,
      ),
    });
  }

  // ── canvas viewport (story 25; layout and zoom never change dependencies) ──

  zoomIn(): void {
    this.set({ zoom: Math.min(1.6, Math.round((this.state.zoom + 0.1) * 10) / 10) });
  }

  zoomOut(): void {
    this.set({ zoom: Math.max(0.4, Math.round((this.state.zoom - 0.1) * 10) / 10) });
  }

  fitZoom(): void {
    this.set({ zoom: 1 });
  }

  structuralProblems(): WorkflowProblem[] {
    return findGraphProblems(this.state.draft.steps);
  }

  // ── operations ────────────────────────────────────────────────────────

  /** 重新生成草稿 (story 23): failure keeps the previous draft and shows why. */
  async regenerate(): Promise<void> {
    if (this.state.status !== "idle") return;
    this.set({ status: "generating", lastError: null });
    const result = await this.operations.generateSteps({ ...this.state.draft });
    if (!result.ok) {
      this.set({
        status: "idle",
        lastError: result.problems.map((problem) => problem.message).join(" "),
      });
      return;
    }
    // Reload the persisted draft (the service bumped revision and steps).
    const latest = this.operations.loadDraft
      ? await this.operations.loadDraft(this.state.draft.id).catch(() => null)
      : null;
    const draft = latest ?? this.state.draft;
    this.set({
      status: "idle",
      draft,
      problems: confirmProblems(draft, this.state.teamGraph),
      dirty: true,
    });
  }

  /** 保存草稿: incomplete drafts are saveable (story 26). */
  async saveDraft(): Promise<boolean> {
    if (this.state.status !== "idle") return false;
    this.set({ status: "saving", lastError: null });
    const result = await this.operations.saveDraft(this.state.draft);
    if (!result.ok) {
      this.set({
        status: "idle",
        lastError: result.problems.map((problem) => problem.message).join(" "),
      });
      return false;
    }
    this.set({
      status: "idle",
      draft: result.value,
      dirty: false,
      problems: confirmProblems(result.value, this.state.teamGraph),
    });
    return true;
  }

  /** 只确认工作流 (story 26): gates only; health and materials never block. */
  async confirmOnly(): Promise<WorkflowResult<WorkflowVersionRecord>> {
    if (this.state.status !== "idle") {
      return {
        ok: false,
        problems: [
          {
            code: "workflow.steps.empty",
            target: { kind: "workflow" },
            message: "正在处理其他操作。",
          },
        ],
      };
    }
    this.set({ status: "confirming", lastError: null });
    const result = await this.operations.confirmDraft(this.state.draft);
    if (!result.ok) {
      this.set({
        status: "idle",
        lastError: result.problems.map((problem) => problem.message).join(" "),
      });
      return result;
    }
    const versions = await this.operations
      .listHistory(this.state.draft.id)
      .catch(() => this.state.versions);
    this.set({
      status: "idle",
      draft: {
        ...this.state.draft,
        status: "confirmed",
        baseVersionNumber: result.value.versionNumber,
      },
      confirmedVersion: result.value,
      versions,
      historyOpen: false,
    });
    return result;
  }

  continueToDispatch(): void {
    if (this.state.problems.length) return;
    this.callbacks.onContinueDispatch?.(this.state.draft, this.state.confirmedVersion);
  }

  backToProject(): void {
    this.callbacks.onBackToProject?.();
  }

  /** Story 27: leaving with unsaved changes warns first. */
  async leave(): Promise<void> {
    if (this.state.dirty) {
      const proceed = await this.guard("有未保存的修改，离开将丢失这些修改。确定离开吗？");
      if (!proceed) return;
    }
    this.backToProject();
  }

  // ── history (story 27) ────────────────────────────────────────────────

  async openHistory(): Promise<void> {
    const versions = await this.operations
      .listHistory(this.state.draft.id)
      .catch(() => this.state.versions);
    this.set({ historyOpen: !this.state.historyOpen, versions });
  }

  async editVersion(versionNumber: number): Promise<void> {
    if (this.state.dirty) {
      const proceed = await this.guard(
        "有未保存的修改，从历史版本新建修订将丢失这些修改。确定继续吗？",
      );
      if (!proceed) return;
    }
    const draft = await this.operations.startRevision(this.state.draft.id, versionNumber);
    this.set({
      draft,
      dirty: true,
      historyOpen: false,
      confirmedVersion: null,
      selectedStepId: draft.steps[0]?.id ?? null,
      selectedEdge: null,
      problems: confirmProblems(draft, this.state.teamGraph),
    });
  }

  subtitle(): string {
    const { draft, confirmedVersion } = this.state;
    if (confirmedVersion)
      return `${draft.name || "未命名"} · 已确认 v${confirmedVersion.versionNumber}`;
    if (draft.baseVersionNumber !== null)
      return `${draft.name || "未命名"} · 已确认 v${draft.baseVersionNumber}（修订草稿）`;
    return `${draft.name || "未命名"} · 草稿`;
  }
}
