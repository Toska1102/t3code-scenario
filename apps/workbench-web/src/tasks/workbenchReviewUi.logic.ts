import type {
  WorkbenchReviewRecord,
  WorkbenchStepStatus,
} from "../../../../packages/workbench-core/src/tasks/workbenchReviewMemoryStore";

export interface ReviewDiagramStep {
  stepId: string;
  dependsOn: readonly string[];
  executor: string;
  status: WorkbenchStepStatus;
  /** Set on review steps; the decision form anchors on it. */
  reviewerId?: string;
}

export interface DiagramNode {
  stepId: string;
  executor: string;
  status: WorkbenchStepStatus;
  /** Layout column: longest distance from a root step. */
  depth: number;
  /** Row within its column. */
  lane: number;
}

/** Layered layout for the branch diagram: columns by dependency depth, lanes in order. */
export function layoutDiagramSteps(steps: readonly ReviewDiagramStep[]): DiagramNode[] {
  const depths = new Map<string, number>();
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  const depthOf = (stepId: string): number => {
    if (depths.has(stepId)) return depths.get(stepId)!;
    // Guard against cycles by treating an in-progress visit as depth 0.
    depths.set(stepId, 0);
    const step = byId.get(stepId);
    const depth = step ? Math.max(-1, ...step.dependsOn.map(depthOf)) + 1 : 0;
    depths.set(stepId, depth);
    return depth;
  };
  for (const step of steps) depthOf(step.stepId);
  const laneCounters = new Map<number, number>();
  return [...steps]
    .sort(
      (a, b) => depths.get(a.stepId)! - depths.get(b.stepId)! || a.stepId.localeCompare(b.stepId),
    )
    .map((step) => {
      const depth = depths.get(step.stepId)!;
      const lane = laneCounters.get(depth) ?? 0;
      laneCounters.set(depth, lane + 1);
      return {
        stepId: step.stepId,
        executor: step.executor,
        status: step.status,
        depth,
        lane,
      };
    });
}

const STATUS_LABEL: Record<WorkbenchStepStatus, string> = {
  pending: "待执行",
  running: "执行中",
  succeeded: "已完成",
  waitingReview: "待评审",
  approved: "评审通过",
  returned: "已退回",
};

export function statusLabel(status: WorkbenchStepStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export type StatusTone = "neutral" | "active" | "good" | "attention" | "bad";

export function statusTone(status: WorkbenchStepStatus): StatusTone {
  switch (status) {
    case "succeeded":
    case "approved":
      return "good";
    case "waitingReview":
      return "attention";
    case "returned":
      return "bad";
    case "running":
      return "active";
    default:
      return "neutral";
  }
}

/** Steps whose outputs are invalidated when the reviewer returns work to `targetStepId`. */
export function affectedDownstream(
  steps: readonly ReviewDiagramStep[],
  targetStepId: string,
): string[] {
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    for (const upstream of step.dependsOn) {
      dependents.set(upstream, [...(dependents.get(upstream) ?? []), step.stepId]);
    }
  }
  const affected: string[] = [];
  const visited = new Set([targetStepId]);
  const queue = [...(dependents.get(targetStepId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    affected.push(current);
    queue.push(...(dependents.get(current) ?? []));
  }
  return affected;
}

/** The review the actor can act on, or undefined when someone else already decided. */
export function findOpenReview(
  reviews: readonly WorkbenchReviewRecord[],
  stepId: string,
): WorkbenchReviewRecord | undefined {
  return reviews.find((record) => record.stepId === stepId && record.status === "open");
}
