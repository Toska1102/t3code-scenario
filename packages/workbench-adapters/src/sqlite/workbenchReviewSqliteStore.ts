import type * as NodeSqlite from "node:sqlite";

import type { WorkbenchReviewTask } from "../../../workbench-core/src/tasks/workbenchReview.ts";
import type {
  WorkbenchReviewRecord,
  WorkbenchReviewStore,
  WorkbenchStepRun,
  WorkbenchTaskReviewState,
} from "../../../workbench-core/src/tasks/workbenchReviewMemoryStore.ts";

type TaskRow = { definition: string; version: number };
type JsonRow = { snapshot: string };

export function createWorkbenchReviewSqliteStore(
  database: NodeSqlite.DatabaseSync,
): WorkbenchReviewStore {
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
  `);

  function transaction<Value>(mode: "DEFERRED" | "IMMEDIATE", action: () => Value): Value {
    database.exec(`BEGIN ${mode}`);
    try {
      const result = action();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  transaction("IMMEDIATE", () =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS workbench_review_tasks (
      task_id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 0)
    );
    CREATE TABLE IF NOT EXISTS workbench_review_attempts (
      task_id TEXT NOT NULL REFERENCES workbench_review_tasks(task_id),
      step_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      snapshot TEXT NOT NULL,
      PRIMARY KEY (task_id, step_id, attempt)
    );
    CREATE TABLE IF NOT EXISTS workbench_reviews (
      task_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      PRIMARY KEY (task_id, step_id, attempt),
      FOREIGN KEY (task_id, step_id, attempt)
        REFERENCES workbench_review_attempts(task_id, step_id, attempt)
    );
  `),
  );

  const findTask = database.prepare(
    "SELECT definition, version FROM workbench_review_tasks WHERE task_id = ?",
  );
  const findAttempts = database.prepare(`
    SELECT snapshot FROM workbench_review_attempts AS run
    WHERE task_id = ? AND attempt = (
      SELECT MAX(attempt) FROM workbench_review_attempts
      WHERE task_id = run.task_id AND step_id = run.step_id
    ) ORDER BY step_id
  `);
  const findReviews = database.prepare(
    "SELECT snapshot FROM workbench_reviews WHERE task_id = ? ORDER BY rowid",
  );
  const insertTask = database.prepare(
    "INSERT INTO workbench_review_tasks VALUES (?, ?, ?) ON CONFLICT(task_id) DO NOTHING",
  );
  const updateTask = database.prepare(
    "UPDATE workbench_review_tasks SET version = ? WHERE task_id = ? AND version = ?",
  );
  const saveAttempt = database.prepare(`
    INSERT INTO workbench_review_attempts VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id, step_id, attempt) DO UPDATE SET snapshot = excluded.snapshot
  `);
  const saveReview = database.prepare(`
    INSERT INTO workbench_reviews VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id, step_id, attempt) DO UPDATE SET snapshot = excluded.snapshot
  `);

  function readTask(taskId: string): WorkbenchTaskReviewState | undefined {
    const row = findTask.get(taskId) as TaskRow | undefined;
    if (!row) return undefined;
    const runs = (findAttempts.all(taskId) as JsonRow[]).map(
      (run) => JSON.parse(run.snapshot) as WorkbenchStepRun,
    );
    return {
      task: JSON.parse(row.definition) as WorkbenchReviewTask,
      version: row.version,
      stepRuns: Object.fromEntries(runs.map((run) => [run.stepId, run])),
      reviews: (findReviews.all(taskId) as JsonRow[]).map(
        (review) => JSON.parse(review.snapshot) as WorkbenchReviewRecord,
      ),
    };
  }

  function saveChildren(state: WorkbenchTaskReviewState) {
    for (const run of Object.values(state.stepRuns)) {
      saveAttempt.run(state.task.taskId, run.stepId, run.attempt, JSON.stringify(run));
    }
    for (const review of state.reviews) {
      saveReview.run(state.task.taskId, review.stepId, review.attempt, JSON.stringify(review));
    }
  }

  return {
    createTask(state) {
      return transaction("IMMEDIATE", () => {
        const created = insertTask.run(
          state.task.taskId,
          JSON.stringify(state.task),
          state.version,
        );
        if (created.changes === 0) return null;
        saveChildren(state);
        return structuredClone(state);
      });
    },
    getTask(taskId) {
      return transaction("DEFERRED", () => readTask(taskId));
    },
    listTasks() {
      return transaction("DEFERRED", () => {
        const rows = database
          .prepare("SELECT task_id FROM workbench_review_tasks ORDER BY task_id")
          .all() as { task_id: string }[];
        return rows.map((row) => readTask(row.task_id)!);
      });
    },
    mutateTask(taskId, mutate) {
      return transaction("IMMEDIATE", () => {
        const current = readTask(taskId);
        if (!current) throw new Error(`Task not found: ${taskId}`);
        const next = mutate(structuredClone(current));
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        next.version = current.version + 1;
        const updated = updateTask.run(next.version, taskId, current.version);
        if (updated.changes !== 1) throw new Error(`Task changed: ${taskId}`);
        saveChildren(next);
        return structuredClone(next);
      });
    },
  };
}
