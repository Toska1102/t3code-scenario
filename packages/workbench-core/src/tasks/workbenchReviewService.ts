import {
  attemptCreated,
  buildReviewTask,
  downstreamStepIds,
  invalidateApprovalsForReturn,
  isReviewReady,
  findStep,
} from "./workbenchReview.ts";
import type { WorkbenchReviewTask } from "./workbenchReview.ts";
import type {
  WorkbenchReviewRecord,
  WorkbenchReviewStore,
  WorkbenchStepRun,
  WorkbenchTaskReviewState,
} from "./workbenchReviewMemoryStore.ts";

export type WorkbenchReviewErrorCode =
  | "unknown_task"
  | "unknown_step"
  | "review_not_open"
  | "idempotency_conflict"
  | "invalid_step_completion"
  | "blank_reason"
  | "invalid_return_target";

export class WorkbenchReviewError extends Error {
  readonly code: WorkbenchReviewErrorCode;
  constructor(code: WorkbenchReviewErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WorkbenchReviewQueueEntry {
  taskId: string;
  stepId: string;
  attempt: number;
  assignedReviewerId: string;
  executor: string;
}

export interface WorkbenchReviewEvents {
  "review.opened": WorkbenchReviewRecord;
  "review.decided": WorkbenchReviewRecord;
  "attempt.created": { taskId: string; stepId: string; attempt: number };
}

export type WorkbenchReviewEvent = {
  [K in keyof WorkbenchReviewEvents]: { type: K; payload: WorkbenchReviewEvents[K] };
}[keyof WorkbenchReviewEvents];

export interface CreateWorkbenchReviewServiceOptions {
  store: WorkbenchReviewStore;
  now?: () => string;
  onEvent?: (event: WorkbenchReviewEvent) => void;
}

export interface DecideReviewInput {
  taskId: string;
  stepId: string;
  attempt: number;
  decision: "approve" | "return";
  reason?: string;
  returnToStepId?: string;
  requestId?: string;
}

export interface DecideReviewActor {
  /** Always derived from authentication by the transport layer, never from a payload. */
  actorId: string;
}

export function createWorkbenchReviewService(options: CreateWorkbenchReviewServiceOptions) {
  const { store } = options;
  const now = options.now ?? (() => new Date().toISOString());

  function mutateTask(
    taskId: string,
    mutate: (
      state: WorkbenchTaskReviewState,
      emit: (event: WorkbenchReviewEvent) => void,
    ) => WorkbenchTaskReviewState,
  ) {
    const events: WorkbenchReviewEvent[] = [];
    const next = store.mutateTask(taskId, (state) =>
      mutate(state, (event) => events.push(structuredClone(event))),
    );
    for (const event of events) options.onEvent?.(event);
    return next;
  }

  function requireTask(taskId: string): WorkbenchTaskReviewState {
    const state = store.getTask(taskId);
    if (!state) throw new WorkbenchReviewError("unknown_task", `Unknown task: ${taskId}`);
    return state;
  }

  function settleReadySteps(
    state: WorkbenchTaskReviewState,
    emit: (event: WorkbenchReviewEvent) => void,
  ): WorkbenchTaskReviewState {
    const succeeded = new Set(
      Object.values(state.stepRuns)
        .filter((run) => run.status === "succeeded" || run.status === "approved")
        .map((run) => run.stepId),
    );
    for (const step of state.task.steps) {
      const run = state.stepRuns[step.stepId];
      if (!run) throw new WorkbenchReviewError("unknown_step", `Unknown step: ${step.stepId}`);
      // The execution engine drives plain steps; only review steps open on join.
      if (!step.reviewerId || run.status !== "pending") continue;
      if (!isReviewReady(state.task, step.stepId, succeeded)) continue;
      const record: WorkbenchReviewRecord = {
        taskId: state.task.taskId,
        stepId: step.stepId,
        attempt: run.attempt,
        status: "open",
        assignedReviewerId: step.reviewerId,
      };
      state.reviews.push(record);
      run.status = "waitingReview";
      emit({ type: "review.opened", payload: record });
    }
    return state;
  }

  return {
    createTask(input: { taskId: string; steps: WorkbenchReviewTask["steps"] }): void {
      const stepRuns: Record<string, WorkbenchStepRun> = {};
      for (const step of input.steps) {
        stepRuns[step.stepId] = { stepId: step.stepId, attempt: 1, status: "pending" };
      }
      const created = store.createTask({
        task: buildReviewTask(input),
        stepRuns,
        reviews: [],
        version: 0,
      });
      if (!created)
        throw new WorkbenchReviewError("unknown_task", `Task already exists: ${input.taskId}`);
    },

    /** Execution engine reports a step output; opens the review once the join is satisfied. */
    completeStep(input: { taskId: string; stepId: string; attempt?: number }): void {
      requireTask(input.taskId);
      mutateTask(input.taskId, (state, emit) => {
        const run = state.stepRuns[input.stepId];
        if (!run) throw new WorkbenchReviewError("unknown_step", `Unknown step: ${input.stepId}`);
        if (
          findStep(state.task, input.stepId)?.reviewerId ||
          (input.attempt !== undefined && input.attempt !== run.attempt)
        ) {
          throw new WorkbenchReviewError(
            "invalid_step_completion",
            "Only the current execution attempt can complete a plain step",
          );
        }
        run.status = "succeeded";
        return settleReadySteps(state, emit);
      });
    },

    /** Pending reviews visible in the queue; `reviewerId` scopes it to one person's todo (D04). */
    listOpenReviews(query: { reviewerId?: string } = {}): WorkbenchReviewQueueEntry[] {
      const entries: WorkbenchReviewQueueEntry[] = [];
      for (const state of store.listTasks()) {
        const byStep = new Map(state.task.steps.map((step) => [step.stepId, step]));
        for (const record of state.reviews) {
          if (record.status !== "open") continue;
          if (query.reviewerId && record.assignedReviewerId !== query.reviewerId) continue;
          entries.push({
            taskId: record.taskId,
            stepId: record.stepId,
            attempt: record.attempt,
            assignedReviewerId: record.assignedReviewerId,
            executor: byStep.get(record.stepId)?.executor ?? "",
          });
        }
      }
      return entries;
    },

    getTask(taskId: string): WorkbenchTaskReviewState | undefined {
      return store.getTask(taskId);
    },

    getReviewHistory(query: { taskId: string; stepId: string }): WorkbenchReviewRecord[] {
      return requireTask(query.taskId).reviews.filter((record) => record.stepId === query.stepId);
    },

    /**
     * Compare-and-set transactional review decision tied to task, step and attempt:
     * it commits only while the record for that exact key is still open, so stale or
     * duplicate submissions never produce a second result.
     */
    decideReview(input: DecideReviewInput, actor: DecideReviewActor): WorkbenchReviewRecord {
      requireTask(input.taskId);
      let decided: WorkbenchReviewRecord | undefined;
      mutateTask(input.taskId, (state, emit) => {
        const receipt = input.requestId
          ? state.reviews.find((review) => review.requestId === input.requestId)
          : undefined;
        if (receipt) {
          if (
            receipt.stepId !== input.stepId ||
            receipt.attempt !== input.attempt ||
            receipt.status !== (input.decision === "approve" ? "approved" : "returned") ||
            receipt.decidedByActorId !== actor.actorId ||
            (input.decision === "return" &&
              (receipt.reason !== input.reason || receipt.returnToStepId !== input.returnToStepId))
          ) {
            throw new WorkbenchReviewError(
              "idempotency_conflict",
              "Request ID already belongs to another decision",
            );
          }
          decided = receipt;
          return state;
        }
        const step = findStep(state.task, input.stepId);
        if (!step) throw new WorkbenchReviewError("unknown_step", `Unknown step: ${input.stepId}`);
        const record = state.reviews.find(
          (candidate) => candidate.stepId === input.stepId && candidate.attempt === input.attempt,
        );
        // The compare-and-set: only an open record at the exact (step, attempt) key commits.
        const run = state.stepRuns[input.stepId];
        if (
          !record ||
          !run ||
          record.status !== "open" ||
          run.attempt !== input.attempt ||
          run.status !== "waitingReview"
        ) {
          throw new WorkbenchReviewError(
            "review_not_open",
            `Review ${input.stepId} attempt ${input.attempt} is not open`,
          );
        }
        record.decidedByActorId = actor.actorId;
        record.decidedAt = now();
        if (input.requestId) record.requestId = input.requestId;
        decided = record;
        if (input.decision === "approve") {
          record.status = "approved";
          run.status = "approved";
        } else {
          if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
            throw new WorkbenchReviewError("blank_reason", "A return needs a nonblank reason");
          }
          const target = findStep(state.task, input.returnToStepId ?? "");
          if (!target || !isAncestorOf(state.task, target.stepId, input.stepId)) {
            throw new WorkbenchReviewError(
              "invalid_return_target",
              `Invalid rework target: ${input.returnToStepId}`,
            );
          }
          record.status = "returned";
          record.reason = input.reason;
          record.returnToStepId = target.stepId;
          run.status = "returned";
          return applyReturn(state, {
            targetStepId: target.stepId,
            record,
            context: { attemptCreated, invalidateApprovalsForReturn, downstreamStepIds, emit },
          });
        }
        emit({ type: "review.decided", payload: record });
        return settleReadySteps(state, emit);
      });
      return decided!;
    },
  };
}

interface ReturnContext {
  attemptCreated: (previous: { attempt: number }) => { attempt: number };
  invalidateApprovalsForReturn: (
    task: WorkbenchReviewTask,
    returnedStepId: string,
    approvedStepIds: ReadonlySet<string>,
  ) => Set<string>;
  downstreamStepIds: (task: WorkbenchReviewTask, stepId: string) => string[];
  emit: (event: WorkbenchReviewEvent) => void;
}

/** Starts a fresh attempt at the rework target and invalidates dependent outputs (A04/R10). */
function applyReturn(
  state: WorkbenchTaskReviewState,
  input: { targetStepId: string; record: WorkbenchReviewRecord; context: ReturnContext },
): WorkbenchTaskReviewState {
  const { targetStepId, record, context } = input;
  const completed = new Set(
    Object.values(state.stepRuns)
      .filter((run) => run.status === "succeeded" || run.status === "approved")
      .map((run) => run.stepId),
  );
  const invalidated = context.invalidateApprovalsForReturn(state.task, targetStepId, completed);
  // The review step's own output also depends on the reworked chain.
  for (const stepId of context.downstreamStepIds(state.task, targetStepId)) {
    invalidated.add(stepId);
  }
  for (const stepId of invalidated) {
    const previous = state.stepRuns[stepId];
    if (!previous) throw new WorkbenchReviewError("unknown_step", `Unknown step: ${stepId}`);
    for (const review of state.reviews) {
      if (review.stepId === stepId && review.status === "open") review.status = "invalidated";
    }
    const next = context.attemptCreated(previous);
    state.stepRuns[stepId] = { ...next, stepId, status: "pending" };
    context.emit({
      type: "attempt.created",
      payload: { taskId: state.task.taskId, stepId, attempt: next.attempt },
    });
  }
  context.emit({ type: "review.decided", payload: record });
  return state;
}

export type WorkbenchReviewService = ReturnType<typeof createWorkbenchReviewService>;

/** True when `ancestorId` is a transitive producer feeding `stepId` — a legal rework target. */
function isAncestorOf(task: WorkbenchReviewTask, ancestorId: string, stepId: string): boolean {
  const step = findStep(task, stepId);
  if (!step) return false;
  const visited = new Set<string>();
  const stack = [...step.dependsOn];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === ancestorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const upstream = findStep(task, current);
    if (upstream) stack.push(...upstream.dependsOn);
  }
  return false;
}
