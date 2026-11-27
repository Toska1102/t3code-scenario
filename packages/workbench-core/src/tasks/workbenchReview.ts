export interface WorkbenchReviewStep {
  readonly stepId: string;
  readonly dependsOn: readonly string[];
  /** Human-readable executor label shown on the branch diagram, e.g. "招聘 / Codex". */
  readonly executor: string;
  /** Set only on review steps; the assigned reviewer owns the decision (D03/D04). */
  readonly reviewerId?: string;
}

export interface WorkbenchReviewTask {
  readonly taskId: string;
  readonly steps: readonly WorkbenchReviewStep[];
}

export function buildReviewTask(input: {
  taskId: string;
  steps: readonly WorkbenchReviewStep[];
}): WorkbenchReviewTask {
  return { taskId: input.taskId, steps: input.steps };
}

export function findStep(
  task: WorkbenchReviewTask,
  stepId: string,
): WorkbenchReviewStep | undefined {
  return task.steps.find((step) => step.stepId === stepId);
}

/**
 * A review step opens only once every direct upstream step has succeeded (R06).
 * Parallel branches may complete in any order; the join waits for all of them.
 */
export function isReviewReady(
  task: WorkbenchReviewTask,
  stepId: string,
  succeededStepIds: ReadonlySet<string>,
): boolean {
  const step = findStep(task, stepId);
  if (!step) return false;
  return step.dependsOn.every((upstream) => succeededStepIds.has(upstream));
}

/** Steps that transitively consume the step's output, direct and indirect. */
export function downstreamStepIds(task: WorkbenchReviewTask, stepId: string): string[] {
  const dependents = new Map<string, string[]>();
  for (const step of task.steps) {
    for (const upstream of step.dependsOn) {
      const bucket = dependents.get(upstream) ?? [];
      bucket.push(step.stepId);
      dependents.set(upstream, bucket);
    }
  }
  const result: string[] = [];
  const visited = new Set<string>([stepId]);
  const queue = [...(dependents.get(stepId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    queue.push(...(dependents.get(current) ?? []));
  }
  return result;
}

/**
 * A returned output invalidates the approval of everything downstream of it (A04),
 * while steps on independent branches and historical review records stay intact (R10).
 */
export function invalidateApprovalsForReturn(
  task: WorkbenchReviewTask,
  returnedStepId: string,
  approvedStepIds: ReadonlySet<string>,
): Set<string> {
  const invalidated = new Set<string>([returnedStepId]);
  for (const stepId of downstreamStepIds(task, returnedStepId)) {
    if (approvedStepIds.has(stepId)) invalidated.add(stepId);
  }
  return invalidated;
}

export interface WorkbenchStepAttempt {
  readonly attempt: number;
}

/** Returning work starts an independent attempt; history from earlier attempts is kept. */
export function attemptCreated(previous: WorkbenchStepAttempt): WorkbenchStepAttempt {
  return { attempt: previous.attempt + 1 };
}
