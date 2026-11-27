// 组织架构领域：节点、汇报关系、评审规则与合法性校验。
// 规格故事 9–12：三层、唯一根、相邻层多上级、删除预览、必审规则、岗位约束。
// 依赖方向：本模块只依赖业务值与规则，不依赖 React、传输、SQL、Effect 与 T3。

export type NodeId = string;

export type OrgNodeType = "role" | "capability";

export type NodeAssignee =
  | { kind: "person"; personId: string }
  | { kind: "agent"; instanceId: string };

export interface ReviewRule {
  id: string;
  /** 适用的任务类型，例如「简历审核」。 */
  taskType: string;
  reviewerNodeId: NodeId;
  required: boolean;
}

export interface OrgNode {
  id: NodeId;
  name: string;
  type: OrgNodeType;
  responsibility: string;
  assignee: NodeAssignee | null;
  /** 直接上级；根节点为空。多上级必须在相邻层（故事 10）。 */
  parentIds: NodeId[];
  reviewRules: ReviewRule[];
  prompt: string;
  tools: string[];
  /** 正整数；null 表示不限制。 */
  tokenLimit: number | null;
  models: string[];
}

export interface OrganizationDraft {
  rootNodeId: NodeId;
  nodes: OrgNode[];
}

export type OrganizationIssueCode =
  | "root_required"
  | "multiple_roots"
  | "duplicate_node_id"
  | "missing_parent"
  | "dangling_parent"
  | "duplicate_parent"
  | "self_parent"
  | "cross_layer_parent"
  | "cycle"
  | "layer_limit"
  | "name_required"
  | "invalid_review_rule"
  | "token_limit_invalid";

export interface OrganizationIssue {
  code: OrganizationIssueCode;
  message: string;
  nodeId?: NodeId;
  parentId?: NodeId;
}

export const MAX_LAYERS = 3;

export function findNode(org: OrganizationDraft, nodeId: NodeId): OrgNode | undefined {
  return org.nodes.find((n) => n.id === nodeId);
}

/**
 * 层级从唯一根推导：根为第 1 层，子节点取上级中的最大层数 +1。
 * 多上级下取最大值，使跨层边在相邻性检查中暴露；成环节点推导不到层级。
 */
export function organizationLayers(org: OrganizationDraft): Map<NodeId, number> {
  const layers = new Map<NodeId, number>();
  const root = findNode(org, org.rootNodeId);
  if (!root) return layers;
  layers.set(root.id, 1);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of org.nodes) {
      if (layers.has(node.id)) continue;
      const parentDepths = node.parentIds
        .map((p) => layers.get(p))
        .filter((d): d is number => d !== undefined);
      if (parentDepths.length === 0) continue;
      layers.set(node.id, Math.max(...parentDepths) + 1);
      changed = true;
    }
  }
  return layers;
}

export function childrenOf(org: OrganizationDraft, nodeId: NodeId): OrgNode[] {
  return org.nodes.filter((n) => n.parentIds.includes(nodeId));
}

export function descendantsOf(org: OrganizationDraft, nodeId: NodeId): OrgNode[] {
  const result: OrgNode[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of org.nodes) {
      if (node.parentIds.includes(current) && node.id !== nodeId) {
        result.push(node);
        queue.push(node.id);
      }
    }
  }
  return result;
}

export function validateOrganization(org: OrganizationDraft): OrganizationIssue[] {
  const issues: OrganizationIssue[] = [];
  const byId = new Map(org.nodes.map((n) => [n.id, n]));

  const root = findNode(org, org.rootNodeId);
  if (!root) {
    issues.push({ code: "root_required", message: "组织必须有一个根节点" });
  } else if (root.parentIds.length > 0) {
    issues.push({ code: "multiple_roots", nodeId: root.id, message: "根节点不能有上级" });
  }
  const seenIds = new Set<string>();
  for (const node of org.nodes) {
    if (seenIds.has(node.id)) {
      issues.push({
        code: "duplicate_node_id",
        nodeId: node.id,
        message: `节点 ID ${node.id} 重复`,
      });
    }
    seenIds.add(node.id);
    if (node.id !== org.rootNodeId && node.parentIds.length === 0) {
      issues.push({
        code: "missing_parent",
        nodeId: node.id,
        message: `节点 ${node.name} 缺少上级`,
      });
    }
    if (!node.name.trim()) {
      issues.push({ code: "name_required", nodeId: node.id, message: `节点 ${node.id} 名称必填` });
    }
  }

  const parentsByNode = new Map<NodeId, Set<NodeId>>();
  let hasCycle = false;
  for (const node of org.nodes) {
    const parents = new Set<NodeId>();
    for (const parentId of node.parentIds) {
      if (parentId === node.id) {
        issues.push({
          code: "self_parent",
          nodeId: node.id,
          message: `节点 ${node.name} 不能以自己为上级`,
        });
        continue;
      }
      if (!byId.has(parentId)) {
        issues.push({
          code: "dangling_parent",
          nodeId: node.id,
          parentId,
          message: `节点 ${node.name} 的上级 ${parentId} 不存在`,
        });
        continue;
      }
      if (parents.has(parentId)) {
        issues.push({
          code: "duplicate_parent",
          nodeId: node.id,
          parentId,
          message: `节点 ${node.name} 重复汇报给 ${parentId}`,
        });
        continue;
      }
      parents.add(parentId);
    }
    parentsByNode.set(node.id, parents);
  }

  const layers = organizationLayers(org);
  for (const node of org.nodes) {
    const childLayer = layers.get(node.id);
    if (childLayer === undefined) continue;
    if (childLayer > MAX_LAYERS) {
      issues.push({ code: "layer_limit", nodeId: node.id, message: "组织层级最多三层" });
      continue;
    }
    for (const parentId of parentsByNode.get(node.id) ?? []) {
      const parentLayer = layers.get(parentId);
      if (parentLayer === undefined) continue;
      if (childLayer !== parentLayer + 1) {
        issues.push({
          code: "cross_layer_parent",
          nodeId: node.id,
          parentId,
          message: `节点只能汇报给相邻上层的节点`,
        });
      }
    }
  }

  // 成环检测：沿上级边能否回到出发点（多上级下 DFS 全路径）。
  const visiting = new Set<NodeId>();
  const done = new Set<NodeId>();
  const visit = (nodeId: NodeId): boolean => {
    if (visiting.has(nodeId)) return true;
    if (done.has(nodeId)) return false;
    visiting.add(nodeId);
    const found = (parentsByNode.get(nodeId) ?? new Set()).has(nodeId)
      ? true
      : [...(parentsByNode.get(nodeId) ?? [])].some((p) => visit(p));
    visiting.delete(nodeId);
    done.add(nodeId);
    return found;
  };
  for (const node of org.nodes) {
    if (visit(node.id)) hasCycle = true;
  }
  if (hasCycle) {
    issues.push({ code: "cycle", message: "汇报关系不能成环" });
  }

  for (const node of org.nodes) {
    if (node.tokenLimit !== null && (!Number.isInteger(node.tokenLimit) || node.tokenLimit <= 0)) {
      issues.push({
        code: "token_limit_invalid",
        nodeId: node.id,
        message: "Token 上限必须是正整数",
      });
    }
    for (const rule of node.reviewRules) {
      if (!rule.taskType.trim() || !byId.has(rule.reviewerNodeId)) {
        issues.push({
          code: "invalid_review_rule",
          nodeId: node.id,
          message: `节点 ${node.name} 的评审规则需要明确的任务类型和存在的评审节点`,
        });
      }
    }
  }

  return issues;
}

export function isOrganizationValid(org: OrganizationDraft): boolean {
  return validateOrganization(org).length === 0;
}

export interface DeletePreview {
  nodeId: NodeId;
  nodeName: string;
  /** 连同删除的下属（若用户选择一并删除）。 */
  descendants: Array<{ id: NodeId; name: string }>;
  /** 删除后失去全部上级、必须改挂或一并删除的直属下属。 */
  orphanIds: NodeId[];
  /** 被删节点（及其后代）自身的评审规则。 */
  removedReviewRules: Array<{ nodeId: NodeId; ruleId: string; taskType: string }>;
  /** 存留节点上指向被删节点的评审规则，确认删除后失效移除。 */
  danglingReviewRules: Array<{ nodeId: NodeId; ruleId: string; taskType: string }>;
}

export type DeletePreviewResult =
  | { ok: true; preview: DeletePreview }
  | { ok: false; code: "root_not_deletable" | "node_not_found"; message: string };

export function previewNodeDeletion(org: OrganizationDraft, nodeId: NodeId): DeletePreviewResult {
  const node = findNode(org, nodeId);
  if (!node) {
    return { ok: false, code: "node_not_found", message: `节点 ${nodeId} 不存在` };
  }
  if (nodeId === org.rootNodeId) {
    return { ok: false, code: "root_not_deletable", message: "根节点不可删除" };
  }
  const directChildren = childrenOf(org, nodeId);
  const descendants = descendantsOf(org, nodeId);
  // 直属下属若只汇报给被删节点，则成为孤立节点，须改挂或显式一并删除。
  const orphanIds = directChildren
    .filter((child) => child.parentIds.every((p) => p === nodeId))
    .map((child) => child.id);
  const affected = new Set([nodeId, ...descendants.map((d) => d.id)]);
  const removedReviewRules = org.nodes
    .filter((n) => affected.has(n.id))
    .flatMap((n) =>
      n.reviewRules.map((rule) => ({ nodeId: n.id, ruleId: rule.id, taskType: rule.taskType })),
    );
  const danglingReviewRules = org.nodes
    .filter((n) => !affected.has(n.id))
    .flatMap((n) =>
      n.reviewRules
        .filter((rule) => affected.has(rule.reviewerNodeId))
        .map((rule) => ({ nodeId: n.id, ruleId: rule.id, taskType: rule.taskType })),
    );
  return {
    ok: true,
    preview: {
      nodeId,
      nodeName: node.name,
      descendants: descendants.map((d) => ({ id: d.id, name: d.name })),
      orphanIds,
      removedReviewRules,
      danglingReviewRules,
    },
  };
}

/** 从组织中移除一组节点（仅被删节点，或用户确认一并删除的节点与其后代），并移除指向它们的评审规则。 */
export function removeNodes(org: OrganizationDraft, nodeIds: NodeId[]): OrganizationDraft {
  const affected = new Set(nodeIds);
  return {
    rootNodeId: org.rootNodeId,
    nodes: org.nodes
      .filter((n) => !affected.has(n.id))
      .map((n) => ({
        ...n,
        parentIds: n.parentIds.filter((p) => !affected.has(p)),
        reviewRules: n.reviewRules.filter((rule) => !affected.has(rule.reviewerNodeId)),
      })),
  };
}
