import type { WorkbenchReviewTask } from "./workbenchReview.ts";

export type WorkbenchStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "waitingReview"
  | "approved"
  | "returned";

export interface WorkbenchStepRun {
  stepId: string;
  attempt: number;
  status: WorkbenchStepStatus;
}

export type WorkbenchReviewDecision = "approved" | "returned";

export interface WorkbenchReviewRecord {
  taskId: string;
  stepId: string;
  /** Attempt of the reviewed output; an approval belongs to exactly one attempt (D05). */
  attempt: number;
  status: "open" | "invalidated" | WorkbenchReviewDecision;
  assignedReviewerId: string;
  /** The admin who actually acted; a deputy never gains ownership (D03). */
  decidedByActorId?: string;
  decidedAt?: string;
  reason?: string;
  returnToStepId?: string;
  requestId?: string;
}

export interface WorkbenchTaskReviewState {
  task: WorkbenchReviewTask;
  stepRuns: Record<string, WorkbenchStepRun>;
  reviews: WorkbenchReviewRecord[];
  /** Monotonic version for compare-and-set over the whole task state. */
  version: number;
}

export interface WorkbenchReviewStore {
  /** Creates the task state or returns null when the taskId already exists. */
  createTask(state: WorkbenchTaskReviewState): WorkbenchTaskReviewState | null;
  getTask(taskId: string): WorkbenchTaskReviewState | undefined;
  listTasks(): WorkbenchTaskReviewState[];
  /**
   * Runs `mutate` inside the task's transaction. The state passed in is the current
   * committed state; returning the mutated state commits it with a bumped version.
   * Throwing aborts the transaction and leaves the store untouched.
   */
  mutateTask(
    taskId: string,
    mutate: (state: WorkbenchTaskReviewState) => WorkbenchTaskReviewState,
  ): WorkbenchTaskReviewState;
}

const clone = <T>(value: T): T => structuredClone(value);

export function createWorkbenchReviewMemoryStore(): WorkbenchReviewStore {
  const tasks = new Map<string, WorkbenchTaskReviewState>();
  return {
    createTask(state) {
      if (tasks.has(state.task.taskId)) return null;
      const created = clone(state);
      tasks.set(state.task.taskId, created);
      return clone(created);
    },
    getTask(taskId) {
      const state = tasks.get(taskId);
      return state ? clone(state) : undefined;
    },
    listTasks() {
      return [...tasks.values()].map((state) => clone(state));
    },
    mutateTask(taskId, mutate) {
      const current = tasks.get(taskId);
      if (!current) throw new Error(`Task not found: ${taskId}`);
      // Single-threaded synchronous mutation is the transaction; the caller's throw
      // aborts before any write lands.
      const next = mutate(clone(current));
      if (JSON.stringify(next) === JSON.stringify(current)) return clone(current);
      next.version = current.version + 1;
      tasks.set(taskId, clone(next));
      return clone(next);
    },
  };
}
