import { layoutDiagramSteps, statusLabel, statusTone } from "./workbenchReviewUi.logic";
import type { ReviewDiagramStep } from "./workbenchReviewUi.logic";
import "./workbenchReview.css";

const NODE_WIDTH = 168;
const NODE_HEIGHT = 64;
const GAP_X = 96;
const GAP_Y = 40;
const PADDING = 24;

const TONE_COLOR: Record<string, string> = {
  good: "#3fb96f",
  attention: "#e2b93b",
  bad: "#e06c5f",
  active: "#4cc3dd",
  neutral: "#5b6b84",
};

function edgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midX = (fromX + toX) / 2;
  return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
}

export function ReviewBranchDiagram(props: { steps: readonly ReviewDiagramStep[] }) {
  const nodes = layoutDiagramSteps(props.steps);
  const byId = new Map(nodes.map((node) => [node.stepId, node]));
  const position = (node: (typeof nodes)[number]) => ({
    x: PADDING + node.depth * (NODE_WIDTH + GAP_X),
    y: PADDING + node.lane * (NODE_HEIGHT + GAP_Y),
  });
  const width =
    PADDING * 2 + Math.max(...nodes.map((node) => node.depth)) * (NODE_WIDTH + GAP_X) + NODE_WIDTH;
  const height =
    PADDING * 2 + Math.max(...nodes.map((node) => node.lane)) * (NODE_HEIGHT + GAP_Y) + NODE_HEIGHT;

  return (
    <section className="review-diagram" aria-label="执行步骤依赖图">
      <svg role="img" viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width }}>
        {props.steps.flatMap((step) =>
          step.dependsOn.map((upstream) => {
            const from = byId.get(upstream);
            const to = byId.get(step.stepId);
            if (!from || !to) return null;
            const a = position(from);
            const b = position(to);
            return (
              <path
                key={`${upstream}->${step.stepId}`}
                d={edgePath(a.x + NODE_WIDTH, a.y + NODE_HEIGHT / 2, b.x, b.y + NODE_HEIGHT / 2)}
                className="review-diagram-edge"
              />
            );
          }),
        )}
        {nodes.map((node) => {
          const { x, y } = position(node);
          return (
            <g
              key={node.stepId}
              className="review-diagram-node"
              aria-label={`步骤 ${node.stepId} ${node.executor} ${statusLabel(node.status)}`}
            >
              <rect
                x={x}
                y={y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={10}
                stroke={TONE_COLOR[statusTone(node.status)]}
              />
              <text x={x + 12} y={y + 26} className="review-diagram-step-title">
                {node.stepId}
              </text>
              <text x={x + 12} y={y + 46} className="review-diagram-step-meta">
                {node.executor} · {statusLabel(node.status)}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
