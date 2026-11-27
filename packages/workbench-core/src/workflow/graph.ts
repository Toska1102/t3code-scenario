import {
  edgeId,
  type WorkflowProblem,
  type WorkflowStep,
} from "../../../workbench-contracts/src/workflow/types.ts";

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface DeleteStepImpact {
  downstreamStepTitles: string[];
  directDependentTitles: string[];
  inputStepTitles: string[];
}

export function edgesOf(steps: WorkflowStep[]): DependencyEdge[] {
  return steps.flatMap((step) => step.dependsOn.map((from) => ({ from, to: step.id })));
}

function transitiveDependents(steps: WorkflowStep[], stepId: string): string[] {
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id]);
    }
  }
  const seen = new Set<string>();
  const walk = (id: string): void => {
    for (const next of dependents.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      walk(next);
    }
  };
  walk(stepId);
  return [...seen];
}

/** Structural problems only: cycles, dangling and duplicated dependency edges. */
export function findGraphProblems(steps: WorkflowStep[]): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const seenEdges = new Set<string>();
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      const id = edgeId(dependency, step.id);
      if (seenEdges.has(id)) {
        problems.push({
          code: "graph.duplicateEdge",
          target: { kind: "edge", id },
          message: `「${step.title || step.id}」存在重复依赖连线。`,
        });
        continue;
      }
      seenEdges.add(id);
      if (!byId.has(dependency)) {
        problems.push({
          code: "graph.danglingDependency",
          target: { kind: "edge", id },
          message: `「${step.title || step.id}」依赖的步骤不存在。`,
        });
      }
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): boolean => {
    const current = state.get(id);
    if (current === "done") return true;
    if (current === "visiting") return false;
    state.set(id, "visiting");
    const step = byId.get(id);
    if (!step) {
      state.set(id, "done");
      return true;
    }
    const acyclic = step.dependsOn.every(visit);
    state.set(id, "done");
    return acyclic;
  };
  for (const step of steps) {
    if (!visit(step.id)) {
      problems.push({
        code: "graph.cycle",
        target: { kind: "step", id: step.id },
        message: `「${step.title || step.id}」存在成环的依赖。`,
      });
    }
  }
  return problems;
}

/** Returns the blocking problem, or null when the edge may be added. */
export function canAddEdge(
  steps: WorkflowStep[],
  from: string,
  to: string,
): WorkflowProblem | null {
  if (from === to) {
    return {
      code: "graph.selfEdge",
      target: { kind: "edge", id: edgeId(from, to) },
      message: "步骤不能连接自身。",
    };
  }
  const target = steps.find((step) => step.id === to);
  if (!target) return null;
  if (target.dependsOn.includes(from)) {
    return {
      code: "graph.duplicateEdge",
      target: { kind: "edge", id: edgeId(from, to) },
      message: "这条连线已存在。",
    };
  }
  const reaches = (source: string, wanted: string, seen = new Set<string>()): boolean => {
    if (source === wanted) return true;
    if (seen.has(source)) return false;
    seen.add(source);
    const step = steps.find((candidate) => candidate.id === source);
    return step ? step.dependsOn.some((dependency) => reaches(dependency, wanted, seen)) : false;
  };
  if (reaches(from, to)) {
    return {
      code: "graph.cycle",
      target: { kind: "edge", id: edgeId(from, to) },
      message: "这条连线会形成执行环。",
    };
  }
  return null;
}

export function withEdge(steps: WorkflowStep[], from: string, to: string): WorkflowStep[] {
  return steps.map((step) =>
    step.id === to && !step.dependsOn.includes(from)
      ? { ...step, dependsOn: [...step.dependsOn, from] }
      : step,
  );
}

export function withoutEdges(steps: WorkflowStep[], removed: DependencyEdge[]): WorkflowStep[] {
  return steps.map((step) => ({
    ...step,
    dependsOn: step.dependsOn.filter(
      (from) => !removed.some((edge) => edge.from === from && edge.to === step.id),
    ),
  }));
}

export function deleteStepImpact(steps: WorkflowStep[], stepId: string): DeleteStepImpact {
  const title = (id: string) => steps.find((step) => step.id === id)?.title || id;
  const transitive = transitiveDependents(steps, stepId);
  return {
    downstreamStepTitles: transitive.map(title),
    directDependentTitles: steps
      .filter((step) => step.dependsOn.includes(stepId))
      .map((step) => step.title),
    inputStepTitles: steps
      .filter((step) =>
        step.config.inputRefs.some((ref) => ref.kind === "step" && ref.stepId === stepId),
      )
      .map((step) => step.title),
  };
}

export function removeStep(steps: WorkflowStep[], stepId: string): WorkflowStep[] {
  return steps
    .filter((step) => step.id !== stepId)
    .map((step) => ({
      ...step,
      dependsOn: step.dependsOn.filter((dependency) => dependency !== stepId),
      config: {
        ...step.config,
        inputRefs: step.config.inputRefs.filter(
          (ref) => !(ref.kind === "step" && ref.stepId === stepId),
        ),
      },
    }));
}

/** Column = dependency depth, rows centered per column. Layout never changes execution order. */
export function autoLayout(steps: WorkflowStep[]): WorkflowStep[] {
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const step = steps.find((candidate) => candidate.id === id);
    const value =
      step && step.dependsOn.length
        ? Math.max(...step.dependsOn.map((dependency) => depthOf(dependency, seen))) + 1
        : 0;
    depth.set(id, value);
    return value;
  };
  steps.forEach((step) => depthOf(step.id));
  const columns = new Map<number, string[]>();
  steps.forEach((step) =>
    columns.set(depth.get(step.id)!, [...(columns.get(depth.get(step.id)!) ?? []), step.id]),
  );
  return steps.map((step) => {
    const column = columns.get(depth.get(step.id)!)!;
    const index = column.indexOf(step.id);
    return {
      ...step,
      position: { x: depth.get(step.id)! * 280, y: (index - (column.length - 1) / 2) * 140 + 140 },
    };
  });
}
