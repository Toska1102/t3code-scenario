import { graphLayout } from "./graph";
import type { StepStatus, TaskGraph } from "./domain";
import { cn } from "./cn";

const NODE_W = 200;
const NODE_H = 64;
const GAP_X = 120;
const GAP_Y = 36;
const PAD = 32;

const STATUS_STYLE: Record<StepStatus, string> = {
  done: "border-emerald-400/70 text-white",
  running: "border-cyan-300 text-white",
  failed: "border-red-400/80 text-white",
  blocked: "border-amber-400/70 text-white",
  pending: "border-[#2A384B] text-[#9AA8BC]",
};

function StepNodeView({
  step,
  x,
  y,
  selected,
  onSelect,
}: {
  step: TaskGraph["steps"][number];
  x: number;
  y: number;
  selected: boolean;
  onSelect: (stepId: string) => void;
}) {
  return (
    <button
      type="button"
      data-step-id={step.id}
      data-selected={selected ? "true" : "false"}
      onClick={() => onSelect(step.id)}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
      className={cn(
        "absolute rounded-lg border bg-[#101A29] px-3 py-2 text-left transition-colors",
        STATUS_STYLE[step.status],
        selected && "ring-2 ring-cyan-300",
      )}
    >
      <span className="block truncate text-sm font-medium">{step.title}</span>
      <span className="mt-1 block truncate text-xs text-[#9AA8BC]">
        {step.agentName} ·{" "}
        {step.status === "done"
          ? "已完成"
          : step.status === "running"
            ? "进行中"
            : step.status === "failed"
              ? "失败"
              : step.status === "blocked"
                ? "受阻"
                : "待开始"}
      </span>
    </button>
  );
}

export function StepGraph({
  graph,
  selectedStepId,
  onSelectStep,
}: {
  graph: TaskGraph;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}) {
  const layout = graphLayout(graph);
  const lanesByLayer = new Map<number, number>();
  for (const node of layout.nodes) {
    lanesByLayer.set(node.layer, Math.max(lanesByLayer.get(node.layer) ?? 0, node.lane + 1));
  }
  const maxLanes = Math.max(1, ...lanesByLayer.values());
  const blockHeight = (lanes: number) => lanes * NODE_H + Math.max(0, lanes - 1) * GAP_Y;
  const totalHeight = blockHeight(maxLanes) + PAD * 2;
  const totalWidth =
    PAD * 2 + layout.layerCount * NODE_W + Math.max(0, layout.layerCount - 1) * GAP_X;

  const positionOf = new Map(
    layout.nodes.map((node) => {
      const lanes = lanesByLayer.get(node.layer) ?? 1;
      const x = PAD + node.layer * (NODE_W + GAP_X);
      const y =
        PAD + (totalHeight - PAD * 2 - blockHeight(lanes)) / 2 + node.lane * (NODE_H + GAP_Y);
      return [node.step.id, { x, y }] as const;
    }),
  );

  return (
    <div
      className="relative overflow-auto rounded-lg border border-[#2A384B] bg-[#0A111E]"
      style={{ height: 420 }}
    >
      <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
        <svg className="absolute inset-0" width={totalWidth} height={totalHeight} aria-hidden>
          {layout.edges.map(({ from, to }) => {
            const a = positionOf.get(from.step.id);
            const b = positionOf.get(to.step.id);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${from.step.id}-${to.step.id}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#2F8F6B"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {layout.nodes.map((node) => {
          const position = positionOf.get(node.step.id)!;
          return (
            <StepNodeView
              key={node.step.id}
              step={node.step}
              x={position.x}
              y={position.y}
              selected={selectedStepId === node.step.id}
              onSelect={onSelectStep}
            />
          );
        })}
      </div>
    </div>
  );
}
