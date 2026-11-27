import type {
  TeamGraphNode,
  TeamGraphSnapshot,
} from "../../../workbench-contracts/src/workflow/types.ts";

export interface CandidateEntry {
  node: TeamGraphNode;
  /** True when the node is only in the pool as an ancestor of a selected member. */
  autoIncluded: boolean;
}

export interface CoveragePreview {
  candidateIds: string[];
  autoIncludedIds: string[];
  /** Review rules from the team graph that apply to this workflow name (必审依据). */
  appliedReviewRules: Array<{ ownerNodeId: string; reviewerNodeId: string }>;
}

/**
 * Story 22: the pool is the selected members plus every ancestor path up to
 * the root. Duplicate ancestors appear once. Auto-inclusion only decides the
 * candidate range — it never assigns steps.
 */
export function candidatePool(graph: TeamGraphSnapshot, memberIds: string[]): CandidateEntry[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const entries = new Map<string, CandidateEntry>();
  const selected: string[] = [];
  for (const id of memberIds) {
    const node = byId.get(id);
    if (!node || entries.has(id)) continue;
    entries.set(id, { node, autoIncluded: false });
    selected.push(id);
  }
  // Level-order over ancestor paths so each duplicate ancestor appears once.
  let frontier = selected;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const parent of byId.get(id)?.parents ?? []) {
        const node = byId.get(parent);
        if (!node || entries.has(parent)) continue;
        entries.set(parent, { node, autoIncluded: true });
        next.push(parent);
      }
    }
    frontier = next;
  }
  return [...entries.values()];
}

export function ruleApplies(node: TeamGraphNode, workflowName: string): boolean {
  return node.reviewRules.some((rule) =>
    rule.taskTypeKeywords.some((keyword) => workflowName.includes(keyword)),
  );
}

export function applicableReviewRules(
  graph: TeamGraphSnapshot,
  workflowName: string,
): Array<{ ownerNodeId: string; reviewerNodeId: string }> {
  const rules: Array<{ ownerNodeId: string; reviewerNodeId: string }> = [];
  for (const node of graph.nodes) {
    for (const rule of node.reviewRules) {
      if (!rule.taskTypeKeywords.some((keyword) => workflowName.includes(keyword))) continue;
      rules.push({ ownerNodeId: node.id, reviewerNodeId: rule.reviewerNodeId });
    }
  }
  return rules;
}

export function coveragePreview(
  graph: TeamGraphSnapshot,
  memberIds: string[],
  workflowName: string,
): CoveragePreview {
  const pool = candidatePool(graph, memberIds);
  return {
    candidateIds: pool.map((entry) => entry.node.id),
    autoIncludedIds: pool.filter((entry) => entry.autoIncluded).map((entry) => entry.node.id),
    appliedReviewRules: applicableReviewRules(graph, workflowName),
  };
}
