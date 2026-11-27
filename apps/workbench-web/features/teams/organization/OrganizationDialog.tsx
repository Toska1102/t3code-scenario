// 组织架构弹窗（画板 01.02）。仅依赖 React；团队、人员、Agent 实例与保存
// 行为全部经 props 注入，保存权威校验在服务端。挂载入口见 ./index.ts。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseImportedOrganization, serializeOrganizationForExport } from "./organizationImport.ts";
import {
  MAX_LAYERS,
  organizationLayers,
  previewNodeDeletion,
  removeNodes,
  validateOrganization,
  type OrganizationDraft,
  type OrganizationIssue,
  type OrgNode,
  type ReviewRule,
} from "../../../../../packages/workbench-core/src/teams/organization/index.ts";

export interface PersonRef {
  id: string;
  name: string;
}
export interface AgentInstanceRef {
  id: string;
  name: string;
  available: boolean;
}

export interface SaveOrganizationPayload {
  team: { name: string; description: string };
  organization: OrganizationDraft;
  expectedRevision: number;
}

export type SaveOrganizationResult =
  | { ok: true; revision: number }
  | { ok: false; message?: string; issues?: OrganizationIssue[] };

export interface OrganizationDialogProps {
  team: { id: string; name: string; description: string };
  revision: number;
  organization: OrganizationDraft;
  people: PersonRef[];
  agentInstances: AgentInstanceRef[];
  agentSummary?: { available: number; total: number };
  workflowUsageByNode?: Record<string, number>;
  availableTools?: string[];
  availableModels?: string[];
  onSave: (payload: SaveOrganizationPayload) => Promise<SaveOrganizationResult>;
  onExportYaml?: (yaml: string) => void;
  onClose: () => void;
}

// 画板取色
const COLORS = {
  page: "rgb(10, 15, 26)",
  nav: "rgb(16, 25, 39)",
  card: "rgb(16, 26, 41)",
  canvas: "rgb(13, 23, 37)",
  nodeBg: "rgb(22, 35, 53)",
  nodeSelectedBg: "rgb(21, 46, 61)",
  border: "rgb(42, 56, 75)",
  nodeBorder: "rgb(57, 80, 104)",
  accent: "rgb(26, 221, 255)",
  connector: "rgb(82, 199, 217)",
  text: "rgb(243, 244, 247)",
  muted: "rgb(154, 168, 188)",
  danger: "rgb(239, 67, 67)",
  link: "rgb(69, 96, 118)",
  overlayAmber: "rgb(245, 183, 76)",
};

const SLOT_WIDTH = 256;
const CARD_WIDTH = 216;
const CARD_HEIGHT = 78;
const ROW_HEIGHT = 230;

const DEFAULT_TOOLS = ["读取文件", "写入文件", "执行命令", "网络检索"];
const DEFAULT_MODELS = ["GPT-5.4", "Claude Sonnet 5.5", "Luna"];

let idCounter = 0;
function freshNodeId(): string {
  idCounter += 1;
  return `node-${idCounter}`;
}

/** 画布布局：按层级分行，层内按父节点聚簇水平排布（对应画板三层结构）。 */
function computeLayout(org: OrganizationDraft) {
  const layers = organizationLayers(org);
  const byLayer = new Map<number, OrgNode[]>();
  for (const node of org.nodes) {
    const layer = layers.get(node.id) ?? MAX_LAYERS + 1;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }
  const positions = new Map<string, { x: number; y: number; layer: number }>();
  const maxLayer = Math.max(0, ...byLayer.keys());
  let width = 0;
  for (let layer = 1; layer <= maxLayer; layer += 1) {
    const row = byLayer.get(layer) ?? [];
    const rowWidth = row.length * SLOT_WIDTH;
    width = Math.max(width, rowWidth);
    const offset = (Math.max(width, 1200) - rowWidth) / 2;
    row.forEach((node, index) => {
      positions.set(node.id, {
        x: offset + index * SLOT_WIDTH,
        y: (layer - 1) * ROW_HEIGHT,
        layer,
      });
    });
  }
  return {
    positions,
    width: Math.max(width, 1200),
    height: maxLayer * ROW_HEIGHT + CARD_HEIGHT + 24,
  };
}

function assigneeLabel(
  node: OrgNode,
  people: PersonRef[],
  agents: AgentInstanceRef[],
): { text: string; bound: boolean } {
  if (!node.assignee) return { text: "未绑定", bound: false };
  if (node.assignee.kind === "person") {
    return {
      text: people.find((p) => p.id === node.assignee?.personId)?.name ?? "人员",
      bound: true,
    };
  }
  return {
    text: agents.find((a) => a.id === node.assignee?.instanceId)?.name ?? "Agent",
    bound: true,
  };
}

export function OrganizationDialog(props: OrganizationDialogProps) {
  const {
    team,
    revision,
    people,
    agentInstances,
    agentSummary,
    workflowUsageByNode = {},
    availableTools = DEFAULT_TOOLS,
    availableModels = DEFAULT_MODELS,
    onSave,
    onExportYaml,
    onClose,
  } = props;
  const [draft, setDraft] = useState<OrganizationDraft>(props.organization);
  const [teamName, setTeamName] = useState(team.name);
  const [teamDescription, setTeamDescription] = useState(team.description);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<OrganizationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [layerHint, setLayerHint] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importIssues, setImportIssues] = useState<Array<{ field: string; message: string }>>([]);
  const [importPreview, setImportPreview] = useState<{
    organization: OrganizationDraft;
    team: { name: string; description: string };
  } | null>(null);
  const [deletePreview, setDeletePreview] = useState<null | ReturnType<typeof previewNodeDeletion>>(
    null,
  );
  const [deleteCascade, setDeleteCascade] = useState<Record<string, boolean>>({});
  const [exitGuard, setExitGuard] = useState(false);
  const [zoom, setZoom] = useState(1);

  const layers = useMemo(() => organizationLayers(draft), [draft]);
  const layout = useMemo(() => computeLayout(draft), [draft]);
  const selected = selectedId ? (draft.nodes.find((n) => n.id === selectedId) ?? null) : null;
  const boundAgentCount = draft.nodes.filter((n) => n.assignee?.kind === "agent").length;
  const root = draft.nodes.find((n) => n.id === draft.rootNodeId) ?? null;

  // 未保存修改守卫：弹窗退出规则（取消、返回、Esc、关闭走同一入口）。
  const [initialSnapshot] = useState(() =>
    JSON.stringify([props.organization, team.name, team.description]),
  );
  const dirty = JSON.stringify([draft, teamName, teamDescription]) !== initialSnapshot;
  const requestClose = useCallback(() => {
    if (dirty) setExitGuard(true);
    else onClose();
  }, [dirty, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // 页内联动：选中节点与配置卡片之间的琥珀色虚线（画板标注色）。
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [linkLine, setLinkLine] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const selection = selectedId;
  useLayoutEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl || !selection) {
      setLinkLine(null);
      return;
    }
    const nodeEl = dialogEl.querySelector(`[data-node-id="${selection}"]`);
    const formEl = dialogEl.querySelector('[data-role="node-form"]');
    if (!(nodeEl instanceof HTMLElement) || !(formEl instanceof HTMLElement)) {
      setLinkLine(null);
      return;
    }
    const base = dialogEl.getBoundingClientRect();
    const nodeBox = nodeEl.getBoundingClientRect();
    const formBox = formEl.getBoundingClientRect();
    setLinkLine({
      x1: nodeBox.left + nodeBox.width / 2 - base.left,
      y1: nodeBox.bottom - base.top,
      x2: formBox.left + 24 - base.left,
      y2: formBox.top - base.top + 8,
    });
    // draft/layout 变化会改变节点位置，需要重测；规则误报额外依赖。
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- 重测依赖布局变化而非具体引用
  }, [selection, draft, zoom]);

  const addNode = () => {
    const parent = selected ?? root;
    if (parent) {
      const parentLayer = layers.get(parent.id) ?? 1;
      if (parentLayer >= MAX_LAYERS) {
        setLayerHint(true);
        return;
      }
    }
    setLayerHint(false);
    const node: OrgNode = {
      id: freshNodeId(),
      name: "新岗位",
      type: "role",
      responsibility: "",
      assignee: null,
      parentIds: parent ? [parent.id] : [],
      reviewRules: [],
      prompt: "",
      tools: [],
      tokenLimit: null,
      models: [],
    };
    setDraft((current) => ({
      rootNodeId: current.nodes.length === 0 ? node.id : current.rootNodeId,
      nodes: [...current.nodes, node],
    }));
    setSelectedId(node.id);
    setIssues([]);
    setSaveMessage(null);
  };

  const updateNode = (nodeId: string, patch: Partial<OrgNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    }));
    setIssues([]);
  };

  const confirmDelete = () => {
    if (!deletePreview || !deletePreview.ok) return;
    const { nodeId, descendants, orphanIds } = deletePreview.preview;
    const cascadeIds = [nodeId, ...descendants.map((d) => d.id)].filter(
      (id) => id === nodeId || deleteCascade[id] !== false,
    );
    const rehomeByOrphan: Record<string, string> = {};
    for (const orphanId of orphanIds) {
      if (deleteCascade[orphanId] === false) {
        const select = document.querySelector<HTMLSelectElement>(`[data-rehome="${orphanId}"]`);
        if (select?.value) rehomeByOrphan[orphanId] = select.value;
      }
    }
    setDraft((current) => {
      let next = removeNodes(current, cascadeIds);
      next = {
        ...next,
        nodes: next.nodes.map((n) =>
          rehomeByOrphan[n.id] ? { ...n, parentIds: [rehomeByOrphan[n.id]] } : n,
        ),
      };
      return next;
    });
    setSelectedId(null);
    setDeletePreview(null);
    setDeleteCascade({});
  };

  const save = async () => {
    if (saving) return;
    const found = validateOrganization(draft);
    if (!teamName.trim()) {
      found.push({ code: "name_required", message: "团队名称必填" });
    }
    if (found.length > 0) {
      setIssues(found);
      const firstNode = found.find((i) => i.nodeId)?.nodeId;
      if (firstNode) setSelectedId(firstNode);
      setSaveMessage(null);
      return;
    }
    setSaveMessage(null);
    setSaving(true);
    try {
      const result = await onSave({
        team: { name: teamName.trim(), description: teamDescription },
        organization: draft,
        expectedRevision: revision,
      });
      if (result.ok) {
        onClose();
      } else {
        // 服务失败：保留草稿与输入，给出可重试的错误。
        setSaveMessage(result.message ?? "保存失败，请重试");
        if (result.issues) {
          setIssues(result.issues);
          const firstNode = result.issues.find((i) => i.nodeId)?.nodeId;
          if (firstNode) setSelectedId(firstNode);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const exportYaml = () => {
    // 校验后导出；序列化复用服务端同构 YAML 适配器，凭据与私有绑定不随文件导出。
    const found = validateOrganization(draft);
    if (found.length > 0) {
      setIssues(found);
      setSaveMessage("组织存在校验问题，修正后才能导出 YAML");
      const firstNode = found.find((i) => i.nodeId)?.nodeId;
      if (firstNode) setSelectedId(firstNode);
      return;
    }
    const yaml = serializeOrganizationForExport(draft, {
      name: teamName.trim(),
      description: teamDescription,
    });
    if (onExportYaml) {
      onExportYaml(yaml);
    } else {
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${teamName || "organization"}.yaml`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  };

  const parentCandidates = selected
    ? draft.nodes.filter(
        (n) =>
          n.id !== selected.id && (layers.get(n.id) ?? 0) === (layers.get(selected.id) ?? 0) - 1,
      )
    : [];

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: COLORS.page,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12.5,
    color: COLORS.text,
    font: "400 17.5px Inter, system-ui, sans-serif",
    padding: "12px 17px",
  };
  const labelStyle: React.CSSProperties = {
    color: COLORS.muted,
    font: "500 15px Inter, system-ui, sans-serif",
    marginBottom: 7,
    display: "block",
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="组织架构"
      style={{
        position: "fixed",
        inset: 0,
        background: COLORS.page,
        color: COLORS.text,
        fontFamily: "Inter, system-ui, sans-serif",
        overflow: "auto",
        zIndex: 50,
      }}
    >
      {/* 顶部导航 */}
      <header
        style={{
          background: COLORS.nav,
          borderBottom: `1px solid ${COLORS.border}`,
          height: 80,
          display: "flex",
          alignItems: "center",
          padding: "0 40px",
          gap: 12,
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 35,
            height: 35,
            border: "1.5px solid rgba(26, 221, 255, 0.4)",
            borderRadius: 12.5,
            display: "grid",
            placeItems: "center",
            color: COLORS.accent,
            fontWeight: 600,
          }}
        >
          A
        </span>
        <ol
          style={{
            display: "flex",
            gap: 7,
            listStyle: "none",
            margin: 0,
            padding: 0,
            fontSize: 17.5,
          }}
        >
          <li style={{ fontWeight: 600 }}>{teamName || "团队"}</li>
          <li aria-hidden="true" style={{ color: COLORS.muted }}>
            /
          </li>
          <li style={{ color: COLORS.muted }}>组织架构</li>
        </ol>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={requestClose}
          style={{
            background: COLORS.page,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12.5,
            color: COLORS.text,
            height: 45,
            padding: "0 17px",
            fontSize: 17.5,
          }}
        >
          返回
        </button>
        {agentSummary && (
          <span
            style={{
              background: COLORS.page,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12.5,
              height: 45,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 17px",
              gap: 10,
              fontSize: 17.5,
              fontWeight: 500,
            }}
          >
            Agent 连接
            <span style={{ color: COLORS.muted, fontSize: 15 }}>
              {agentSummary.available} / {agentSummary.total} 可用
            </span>
          </span>
        )}
      </header>

      <main style={{ padding: "48px 48px 0" }}>
        <h1 style={{ fontSize: 44, fontWeight: 600, margin: "0 0 32px" }}>组织架构</h1>

        {/* 团队配置 */}
        <section
          aria-label="团队配置"
          style={{
            background: COLORS.card,
            borderRadius: 14,
            borderTop: `1px solid ${COLORS.border}`,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 24,
              padding: "32px 32px 24px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 320px" }}>
              <h2 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>团队配置</h2>
              <p style={{ color: COLORS.muted, fontSize: 15, margin: "8px 0 0" }}>
                从上到下按层级展开，连线表示直接汇报关系。
              </p>
            </div>
            <div style={{ flex: "0 1 300px" }}>
              <label htmlFor="team-name" style={labelStyle}>
                团队名称
              </label>
              <input
                id="team-name"
                aria-label="团队名称"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: "1 1 420px" }}>
              <label htmlFor="team-description" style={labelStyle}>
                团队描述
              </label>
              <input
                id="team-description"
                aria-label="团队描述"
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* 组织树操作 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderTop: `1px solid ${COLORS.border}`,
              padding: "14px 32px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={addNode}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                background: COLORS.page,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12.5,
                color: COLORS.text,
                height: 45,
                padding: "0 17px",
                fontSize: 17.5,
                fontWeight: 500,
              }}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
                <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
              添加节点
            </button>
            {layerHint ? (
              <span style={{ color: COLORS.danger, fontSize: 15 }}>
                第三层节点下不能再添加，请选择其他上级节点
              </span>
            ) : (
              <span style={{ color: COLORS.muted, fontSize: 15 }}>新节点会挂在当前选中节点下</span>
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => {
                setImportOpen(true);
                setImportIssues([]);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                background: COLORS.page,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12.5,
                color: COLORS.text,
                height: 45,
                padding: "0 17px",
                fontSize: 17.5,
                fontWeight: 500,
              }}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
                <path
                  d="M10 3v10m0 0 4-4m-4 4-4-4M4 16h12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                />
              </svg>
              导入 YAML
            </button>
            <button
              type="button"
              onClick={exportYaml}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                background: COLORS.page,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12.5,
                color: COLORS.text,
                height: 45,
                padding: "0 17px",
                fontSize: 17.5,
                fontWeight: 500,
              }}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
                <path
                  d="M10 13V3m0 0 4 4m-4-4-4 4M4 16h12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                />
              </svg>
              导出 YAML
            </button>
          </div>

          {/* 组织汇报关系图 */}
          <div
            data-role="canvas"
            aria-label="组织汇报关系图"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
            onWheel={(e) => {
              // 画布可原生滚动平移；Ctrl+滚轮缩放。
              if (!e.ctrlKey) return;
              setZoom((z) => Math.min(1.6, Math.max(0.6, z - e.deltaY * 0.002)));
            }}
            style={{
              background: COLORS.canvas,
              margin: "0 1px",
              backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`,
              backgroundSize: "40px 40px",
              height: 480,
              overflow: "auto",
              position: "relative",
              cursor: "grab",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 12,
                display: "flex",
                gap: 6,
                zIndex: 1,
              }}
            >
              <button
                type="button"
                aria-label="放大画布"
                onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
                style={{
                  background: COLORS.nodeBg,
                  border: `1px solid ${COLORS.nodeBorder}`,
                  borderRadius: 8,
                  color: COLORS.text,
                  width: 32,
                  height: 32,
                }}
              >
                +
              </button>
              <button
                type="button"
                aria-label="缩小画布"
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
                style={{
                  background: COLORS.nodeBg,
                  border: `1px solid ${COLORS.nodeBorder}`,
                  borderRadius: 8,
                  color: COLORS.text,
                  width: 32,
                  height: 32,
                }}
              >
                −
              </button>
              <button
                type="button"
                aria-label="重置画布视图"
                onClick={() => setZoom(1)}
                style={{
                  background: COLORS.nodeBg,
                  border: `1px solid ${COLORS.nodeBorder}`,
                  borderRadius: 8,
                  color: COLORS.text,
                  width: 32,
                  height: 32,
                }}
              >
                ⟳
              </button>
            </div>
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
                position: "relative",
                width: layout.width,
                height: layout.height,
                margin: "0 auto",
              }}
            >
              <svg
                aria-hidden="true"
                width={layout.width}
                height={layout.height}
                style={{ position: "absolute", inset: 0 }}
              >
                <defs>
                  <marker
                    id="wb-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="4"
                    orient="auto"
                  >
                    <path
                      d="M0 0 L7 4 L0 8"
                      fill="none"
                      stroke={COLORS.connector}
                      strokeWidth="1.4"
                    />
                  </marker>
                </defs>
                {draft.nodes.flatMap((child) =>
                  child.parentIds.map((parentId) => {
                    const from = layout.positions.get(parentId);
                    const to = layout.positions.get(child.id);
                    if (!from || !to) return null;
                    const x1 = from.x + CARD_WIDTH / 2;
                    const y1 = from.y + CARD_HEIGHT;
                    const x2 = to.x + CARD_WIDTH / 2;
                    const y2 = to.y;
                    const midY = y1 + (y2 - y1) / 2;
                    return (
                      <path
                        key={`${parentId}->${child.id}`}
                        d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2 - 6}`}
                        fill="none"
                        stroke={COLORS.connector}
                        strokeWidth="1.5"
                        markerEnd="url(#wb-arrow)"
                      />
                    );
                  }),
                )}
              </svg>
              {draft.nodes.map((node) => {
                const pos = layout.positions.get(node.id);
                if (!pos) return null;
                const isSelected = node.id === selectedId;
                const label = assigneeLabel(node, people, agentInstances);
                return (
                  <button
                    key={node.id}
                    type="button"
                    data-node-id={node.id}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedId(node.id);
                      setLayerHint(false);
                    }}
                    style={{
                      position: "absolute",
                      left: pos.x,
                      top: pos.y,
                      width: CARD_WIDTH,
                      minHeight: CARD_HEIGHT,
                      background: isSelected ? COLORS.nodeSelectedBg : COLORS.nodeBg,
                      border: `1px solid ${isSelected ? COLORS.connector : COLORS.nodeBorder}`,
                      borderRadius: 12,
                      color: COLORS.text,
                      textAlign: "center",
                      padding: "14px 8px",
                      outline: isSelected ? `2px dashed ${COLORS.overlayAmber}` : "none",
                      outlineOffset: 2,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "block", fontSize: 20, fontWeight: 600 }}>
                      {node.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 16,
                        marginTop: 6,
                        color: label.bound ? COLORS.accent : COLORS.muted,
                      }}
                    >
                      {label.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 导入 YAML 面板 */}
        {importOpen && (
          <section
            aria-label="导入 YAML"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 24,
              marginTop: 16,
            }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 23, fontWeight: 600 }}>导入 YAML</h3>
            <input
              type="file"
              aria-label="选择 YAML 文件"
              accept=".yaml,.yml,.txt"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setImportText(await file.text());
              }}
              style={{ color: COLORS.muted, marginBottom: 12, display: "block" }}
            />
            <textarea
              aria-label="导入 YAML 内容"
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              style={{ ...inputStyle, font: "400 15px ui-monospace, monospace", borderRadius: 10 }}
            />
            {importIssues.length > 0 && (
              <ul
                aria-label="导入错误"
                style={{ color: COLORS.danger, fontSize: 15, margin: "12px 0 0", paddingLeft: 20 }}
              >
                {importIssues.map((issue) => (
                  <li key={`${issue.field}-${issue.message}`}>
                    {issue.field}：{issue.message}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  // 解析与校验复用服务端同构适配器逻辑；失败保留原草稿。
                  const parsed = parseImportedOrganization(importText);
                  if (parsed.ok) {
                    setImportIssues([]);
                    setImportPreview({ organization: parsed.organization, team: parsed.team });
                  } else {
                    setImportPreview(null);
                    setImportIssues(parsed.issues);
                  }
                }}
                style={{
                  background: COLORS.page,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12.5,
                  color: COLORS.text,
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                  fontWeight: 500,
                }}
              >
                解析并预览
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false);
                  setImportPreview(null);
                  setImportIssues([]);
                }}
                style={{
                  background: COLORS.page,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12.5,
                  color: COLORS.text,
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                }}
              >
                取消
              </button>
            </div>
          </section>
        )}

        {/* 所选岗位配置 */}
        <section
          data-role="node-form"
          aria-label="所选岗位配置"
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            padding: 32,
            marginTop: 16,
            borderLeft: selected ? `3px dashed ${COLORS.overlayAmber}` : undefined,
          }}
        >
          {selected ? (
            <NodeForm
              key={selected.id}
              node={selected}
              draft={draft}
              layers={layers}
              people={people}
              agentInstances={agentInstances}
              parentCandidates={parentCandidates}
              availableTools={availableTools}
              availableModels={availableModels}
              issues={issues.filter((i) => i.nodeId === selected.id)}
              inputStyle={inputStyle}
              labelStyle={labelStyle}
              onUpdate={(patch) => updateNode(selected.id, patch)}
              onDelete={() => {
                const result = previewNodeDeletion(draft, selected.id);
                setDeletePreview(result);
                setDeleteCascade(
                  result.ok
                    ? Object.fromEntries(result.preview.orphanIds.map((id) => [id, true]))
                    : {},
                );
              }}
            />
          ) : (
            <p style={{ color: COLORS.muted, fontSize: 17.5, margin: 0 }}>
              在组织图中选择节点后在此配置岗位、汇报关系与评审规则。
            </p>
          )}
        </section>
      </main>

      {/* 页脚 */}
      <footer
        style={{
          borderTop: `1px solid ${COLORS.border}`,
          marginTop: 32,
          padding: "20px 48px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          position: "sticky",
          bottom: 0,
          background: COLORS.page,
        }}
      >
        <span
          style={{ color: COLORS.muted, fontSize: 15 }}
        >{`${draft.nodes.length} 个节点 · ${boundAgentCount} 个绑定 Agent`}</span>
        {issues.length > 0 && (
          <ul
            aria-label="校验问题"
            style={{ color: COLORS.danger, fontSize: 15, margin: 0, paddingLeft: 20 }}
          >
            {issues.slice(0, 3).map((issue) => (
              <li key={`${issue.code}-${issue.nodeId ?? ""}`}>{issue.message}</li>
            ))}
          </ul>
        )}
        {saveMessage && (
          <span role="status" style={{ color: COLORS.danger, fontSize: 15 }}>
            {saveMessage}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={requestClose}
          style={{
            background: COLORS.page,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12.5,
            color: COLORS.text,
            height: 50,
            padding: "0 21px",
            fontSize: 17.5,
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            background: COLORS.accent,
            borderRadius: 12.5,
            color: "rgb(4, 12, 20)",
            height: 50,
            padding: "0 21px",
            fontSize: 17.5,
            fontWeight: 600,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "正在保存" : "保存团队"}
        </button>
      </footer>

      {/* 页内联动连线 */}
      <svg
        ref={overlayRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          width: "100%",
          height: "100%",
        }}
      >
        {linkLine && (
          <line
            x1={linkLine.x1}
            y1={linkLine.y1}
            x2={linkLine.x2}
            y2={linkLine.y2}
            stroke={COLORS.overlayAmber}
            strokeWidth="1.5"
            strokeDasharray="6 5"
          />
        )}
      </svg>

      {/* 删除预览 */}
      {deletePreview?.ok && (
        <div
          role="alertdialog"
          aria-label="删除预览"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 10, 18, 0.7)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
          }}
        >
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 32,
              width: 560,
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 23, fontWeight: 600 }}>
              删除「{deletePreview.preview.nodeName}」
            </h3>
            <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 16px" }}>
              确认后在草稿中移除节点和相关边；已有任务的运行快照保留。
            </p>
            {deletePreview.preview.descendants.length > 0 && (
              <>
                <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 6px" }}>受影响下属：</p>
                <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 17.5 }}>
                  {deletePreview.preview.descendants.map((d) => (
                    <li key={d.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span>{d.name}</span>
                      <label
                        style={{
                          color: COLORS.muted,
                          fontSize: 15,
                          display: "inline-flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`一并删除 ${d.name}`}
                          checked={deleteCascade[d.id] !== false}
                          onChange={(e) =>
                            setDeleteCascade((c) => ({ ...c, [d.id]: e.target.checked }))
                          }
                        />
                        一并删除
                      </label>
                    </li>
                  ))}
                </ul>
                {deletePreview.preview.orphanIds.length > 0 && (
                  <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 12px" }}>
                    孤立下属须改挂到相邻上层节点，或勾选一并删除。
                  </p>
                )}
                {deletePreview.preview.orphanIds.map((orphanId) =>
                  deleteCascade[orphanId] === false ? (
                    <div key={orphanId} style={{ marginBottom: 12 }}>
                      <label htmlFor={`rehome-${orphanId}`} style={labelStyle}>
                        「{draft.nodes.find((n) => n.id === orphanId)?.name}」改挂到
                      </label>
                      <select id={`rehome-${orphanId}`} data-rehome={orphanId} style={inputStyle}>
                        {draft.nodes
                          .filter(
                            (n) =>
                              n.id !== deletePreview.preview.nodeId &&
                              (layers.get(n.id) ?? 0) === (layers.get(orphanId) ?? 1) - 1,
                          )
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : null,
                )}
              </>
            )}
            {deletePreview.preview.removedReviewRules.length > 0 && (
              <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 12px" }}>
                将移除 {deletePreview.preview.removedReviewRules.length} 条评审规则（
                {deletePreview.preview.removedReviewRules.map((r) => r.taskType).join("、")}）。
              </p>
            )}
            {deletePreview.preview.danglingReviewRules.length > 0 && (
              <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 12px" }}>
                另有 {deletePreview.preview.danglingReviewRules.length}{" "}
                条存留节点的评审规则指向被删节点，删除后一并移除。
              </p>
            )}
            {(() => {
              const affected = [
                deletePreview.preview.nodeId,
                ...deletePreview.preview.descendants.map((d) => d.id),
              ];
              const workflows = affected.reduce(
                (sum, id) => sum + (workflowUsageByNode[id] ?? 0),
                0,
              );
              return workflows > 0 ? (
                <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 12px" }}>
                  影响 {workflows} 个任务工作流，修订流程后方可继续派发。
                </p>
              ) : null;
            })()}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeletePreview(null)}
                style={{
                  background: COLORS.page,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12.5,
                  color: COLORS.text,
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                style={{
                  background: COLORS.danger,
                  borderRadius: 12.5,
                  color: "#fff",
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                  fontWeight: 600,
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入预览差异 */}
      {importPreview && (
        <div
          role="dialog"
          aria-label="导入预览"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 10, 18, 0.7)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
          }}
        >
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 32,
              width: 560,
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 23, fontWeight: 600 }}>导入预览</h3>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 17.5 }}>
              <li>团队名称：{importPreview.team.name}</li>
              <li>
                节点数：{draft.nodes.length} → {importPreview.organization.nodes.length}
              </li>
              <li>需重新绑定人员或 Agent 的节点：{importPreview.organization.nodes.length} 个</li>
            </ul>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                style={{
                  background: COLORS.page,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12.5,
                  color: COLORS.text,
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(importPreview.organization);
                  setTeamName(importPreview.team.name);
                  setTeamDescription(importPreview.team.description);
                  setSelectedId(null);
                  setImportPreview(null);
                  setImportOpen(false);
                  setIssues([]);
                }}
                style={{
                  background: COLORS.accent,
                  borderRadius: 12.5,
                  color: "rgb(4, 12, 20)",
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                  fontWeight: 600,
                }}
              >
                应用到草稿
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 退出守卫 */}
      {exitGuard && (
        <div
          role="alertdialog"
          aria-label="未保存的修改"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 10, 18, 0.7)",
            display: "grid",
            placeItems: "center",
            zIndex: 70,
          }}
        >
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 32,
              width: 460,
            }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 23, fontWeight: 600 }}>未保存的修改</h3>
            <p style={{ color: COLORS.muted, fontSize: 15, margin: "0 0 20px" }}>
              组织草稿尚未保存，离开将放弃这些修改。
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setExitGuard(false)}
                style={{
                  background: COLORS.page,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12.5,
                  color: COLORS.text,
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                }}
              >
                继续编辑
              </button>
              <button
                type="button"
                onClick={() => {
                  setExitGuard(false);
                  onClose();
                }}
                style={{
                  background: COLORS.danger,
                  borderRadius: 12.5,
                  color: "#fff",
                  height: 45,
                  padding: "0 17px",
                  fontSize: 17.5,
                  fontWeight: 600,
                }}
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeForm(props: {
  node: OrgNode;
  draft: OrganizationDraft;
  layers: Map<string, number>;
  people: PersonRef[];
  agentInstances: AgentInstanceRef[];
  parentCandidates: OrgNode[];
  availableTools: string[];
  availableModels: string[];
  issues: OrganizationIssue[];
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onUpdate: (patch: Partial<OrgNode>) => void;
  onDelete: () => void;
}) {
  const {
    node,
    people,
    agentInstances,
    parentCandidates,
    availableTools,
    availableModels,
    issues,
    inputStyle,
    labelStyle,
    onUpdate,
    onDelete,
  } = props;
  const isRoot = node.id === props.draft.rootNodeId;
  const ruleText = node.reviewRules
    .map(
      (r) =>
        `${r.taskType} → ${props.draft.nodes.find((n) => n.id === r.reviewerNodeId)?.name ?? r.reviewerNodeId}${r.required ? " 必审" : ""}`,
    )
    .join("；");
  const ruleInputId = `rule-${node.id}`;
  const [ruleDraft, setRuleDraft] = useState(ruleText);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const commitRules = () => {
    const rules: ReviewRule[] = [];
    for (const part of ruleDraft
      .split("；")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const match = part.match(/^(.+?)\s*→\s*(.+?)\s*(必审|可选)?$/);
      const reviewerName = match?.[2];
      const matches = reviewerName ? props.draft.nodes.filter((n) => n.name === reviewerName) : [];
      if (!match || !match[1].trim() || matches.length !== 1) {
        setRuleError("评审规则需要形如「简历审核 → HR 总管 必审」，且评审节点名称唯一存在");
        return;
      }
      rules.push({
        id: `${node.id}-rule-${rules.length + 1}`,
        taskType: match[1].trim(),
        reviewerNodeId: matches[0]!.id,
        required: match[3] === "必审",
      });
    }
    setRuleError(null);
    onUpdate({ reviewRules: rules });
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
        <h2
          aria-label={`岗位配置 · ${node.name}`}
          style={{ fontSize: 30, fontWeight: 600, margin: 0 }}
        >
          岗位配置 · {node.name}
        </h2>
        <span style={{ flex: 1 }} />
        {!isRoot && (
          <button
            type="button"
            onClick={onDelete}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "none",
              color: COLORS.danger,
              fontSize: 17.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
              <path
                d="M4 6h12M8 6V4h4v2m-6 0 1 10h6l1-10"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
            删除
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 24,
        }}
      >
        <div>
          <label htmlFor={`name-${node.id}`} style={labelStyle}>
            名称
          </label>
          <input
            id={`name-${node.id}`}
            aria-label="名称"
            value={node.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor={`type-${node.id}`} style={labelStyle}>
            类型
          </label>
          <select
            id={`type-${node.id}`}
            aria-label="类型"
            value={node.type}
            onChange={(e) => onUpdate({ type: e.target.value as OrgNode["type"] })}
            style={inputStyle}
          >
            <option value="role">岗位</option>
            <option value="capability">能力</option>
          </select>
        </div>
        <div>
          <label htmlFor={`assignee-${node.id}`} style={labelStyle}>
            执行者
          </label>
          <select
            id={`assignee-${node.id}`}
            aria-label="执行者"
            value={
              node.assignee
                ? node.assignee.kind === "person"
                  ? `person:${node.assignee.personId}`
                  : `agent:${node.assignee.instanceId}`
                : ""
            }
            onChange={(e) => {
              const value = e.target.value;
              onUpdate({
                assignee:
                  value === ""
                    ? null
                    : value.startsWith("person:")
                      ? { kind: "person", personId: value.slice(7) }
                      : { kind: "agent", instanceId: value.slice(6) },
              });
            }}
            style={inputStyle}
          >
            <option value="">未绑定</option>
            {people.map((p) => (
              <option key={p.id} value={`person:${p.id}`}>
                人员 · {p.name}
              </option>
            ))}
            {agentInstances.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                Agent · {a.name}
                {a.available ? "" : "（不可用）"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`parents-${node.id}`} style={labelStyle}>
            {isRoot ? "汇报给（根节点）" : "汇报给（可多选相邻上层）"}
          </label>
          {isRoot ? (
            <input
              id={`parents-${node.id}`}
              aria-label="汇报给"
              value="无（根节点）"
              readOnly
              style={{ ...inputStyle, color: COLORS.muted }}
            />
          ) : (
            <select
              id={`parents-${node.id}`}
              aria-label="汇报给"
              multiple
              value={node.parentIds}
              onChange={(e) =>
                onUpdate({ parentIds: Array.from(e.target.selectedOptions).map((o) => o.value) })
              }
              style={{ ...inputStyle, height: 50 }}
            >
              {parentCandidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ gridColumn: "span 1" }}>
          <label htmlFor={`duty-${node.id}`} style={labelStyle}>
            职责
          </label>
          <input
            id={`duty-${node.id}`}
            aria-label="职责"
            value={node.responsibility}
            onChange={(e) => onUpdate({ responsibility: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor={ruleInputId} style={labelStyle}>
            评审规则
          </label>
          <input
            id={ruleInputId}
            aria-label="评审规则"
            value={ruleDraft}
            onChange={(e) => {
              setRuleDraft(e.target.value);
              setRuleError(null);
            }}
            onBlur={commitRules}
            style={inputStyle}
          />
          <p style={{ color: COLORS.muted, fontSize: 15, margin: "6px 0 0" }}>
            例如：简历审核 → HR 总管 必审
          </p>
          {ruleError && (
            <p style={{ color: COLORS.danger, fontSize: 15, margin: "6px 0 0" }}>{ruleError}</p>
          )}
        </div>
      </div>

      <h3 style={{ fontSize: 23, fontWeight: 600, margin: "28px 0 12px" }}>岗位提示词</h3>
      <textarea
        aria-label="岗位提示词"
        rows={12}
        value={node.prompt}
        onChange={(e) => onUpdate({ prompt: e.target.value })}
        style={{
          ...inputStyle,
          border: `1px solid ${COLORS.link}`,
          borderRadius: 10,
          minHeight: 320,
          resize: "vertical",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 24,
          marginTop: 24,
        }}
      >
        <div>
          <label htmlFor={`tools-${node.id}`} style={labelStyle}>
            工具
          </label>
          <select
            id={`tools-${node.id}`}
            aria-label="工具"
            multiple
            value={node.tools}
            onChange={(e) =>
              onUpdate({ tools: Array.from(e.target.selectedOptions).map((o) => o.value) })
            }
            style={{ ...inputStyle, height: 50 }}
          >
            {availableTools.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`token-${node.id}`} style={labelStyle}>
            Token
          </label>
          <input
            id={`token-${node.id}`}
            aria-label="Token"
            inputMode="numeric"
            value={node.tokenLimit ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              onUpdate({ tokenLimit: raw === "" ? null : Number(raw) });
            }}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor={`models-${node.id}`} style={labelStyle}>
            模型
          </label>
          <select
            id={`models-${node.id}`}
            aria-label="模型"
            multiple
            value={node.models}
            onChange={(e) =>
              onUpdate({ models: Array.from(e.target.selectedOptions).map((o) => o.value) })
            }
            style={{ ...inputStyle, height: 50 }}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>

      {issues.length > 0 && (
        <ul
          aria-label="节点校验问题"
          style={{ color: COLORS.danger, fontSize: 15, margin: "16px 0 0", paddingLeft: 20 }}
        >
          {issues.map((issue) => (
            <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      )}
    </>
  );
}
