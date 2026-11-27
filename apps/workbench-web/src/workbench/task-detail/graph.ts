import type { TaskGraph } from "./domain";

export interface PositionedStep {
  readonly step: TaskGraph["steps"][number];
  readonly layer: number;
  readonly lane: number;
}

export interface GraphLayout {
  readonly nodes: readonly PositionedStep[];
  readonly layerCount: number;
  readonly edges: readonly { from: PositionedStep; to: PositionedStep }[];
}

/**
 * Deterministic layered layout: steps are placed in topological layers
 * (longest-path ranking), lanes centered within each layer. Pure — same graph
 * in, same layout out — so the graph render needs no effect logic.
 */
export function graphLayout(graph: TaskGraph): GraphLayout {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const step of graph.steps) {
    incoming.set(step.id, 0);
    outgoing.set(step.id, []);
  }
  for (const edge of graph.edges) {
    if (!incoming.has(edge.to) || !incoming.has(edge.from)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const layerOf = new Map<string, number>();
  const ready = graph.steps.filter((step) => incoming.get(step.id) === 0).map((step) => step.id);
  let layer = 0;
  let remaining = ready;
  while (remaining.length > 0) {
    const next: string[] = [];
    for (const id of remaining) {
      layerOf.set(id, layer);
      for (const to of outgoing.get(id) ?? []) {
        const count = (incoming.get(to) ?? 1) - 1;
        incoming.set(to, count);
        if (count === 0) next.push(to);
      }
    }
    remaining = next;
    layer += 1;
  }
  // Cycles (should not happen) fall back to layer 0 so every step stays visible.
  for (const step of graph.steps) {
    if (!layerOf.has(step.id)) layerOf.set(step.id, 0);
  }

  const byStepId = new Map(graph.steps.map((step) => [step.id, step]));
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layerOf) {
    byLayer.set(l, [...(byLayer.get(l) ?? []), id]);
  }

  const nodes: PositionedStep[] = [];
  for (const [l, ids] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, lane) => {
      const step = byStepId.get(id);
      if (step) nodes.push({ step, layer: l, lane });
    });
  }
  const positionOf = new Map(nodes.map((node) => [node.step.id, node]));
  const edges = graph.edges
    .map((edge) => {
      const from = positionOf.get(edge.from);
      const to = positionOf.get(edge.to);
      return from && to ? { from, to } : null;
    })
    .filter((edge) => edge !== null);

  return { nodes, layerCount: Math.max(1, byLayer.size), edges };
}
