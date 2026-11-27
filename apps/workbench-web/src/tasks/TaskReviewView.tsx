import type { WorkbenchReviewRecord } from "../../../../packages/workbench-core/src/tasks/workbenchReviewMemoryStore";
import { ReviewBranchDiagram } from "./ReviewBranchDiagram";
import { ReviewDecisionForm } from "./ReviewDecisionForm";
import type { ReviewDecision } from "./ReviewDecisionForm";
import type { ReviewActionError } from "./ReviewDecisionForm";
import { ReviewQueue } from "./ReviewQueue";
import type { ReviewQueueEntry } from "./ReviewQueue";
import { statusLabel } from "./workbenchReviewUi.logic";
import type { ReviewDiagramStep } from "./workbenchReviewUi.logic";
import "./workbenchReview.css";

export interface TaskReviewSnapshot {
  taskId: string;
  title: string;
  steps: readonly ReviewDiagramStep[];
  reviews: readonly WorkbenchReviewRecord[];
  queue: readonly ReviewQueueEntry[];
}

/**
 * Ticket 07 surface: parallel join → manual review → return/rework, with the
 * pending queue, the waiting state and the decided state on one task detail view.
 */
export function TaskReviewView(props: {
  snapshot: TaskReviewSnapshot;
  currentUserId: string;
  onDecide: (input: ReviewDecision) => Promise<void>;
  onSelectQueueEntry?: (entry: ReviewQueueEntry) => void;
}) {
  const { snapshot } = props;
  const done = snapshot.steps.filter(
    (step) => step.status === "succeeded" || step.status === "approved",
  ).length;
  return (
    <main className="task-review" aria-label={`任务评审 ${snapshot.title}`}>
      <header className="task-review-header">
        <h2>{snapshot.title}</h2>
        <span className="task-review-progress">
          {done} / {snapshot.steps.length} 步完成
        </span>
      </header>
      <div className="task-review-body">
        <div className="task-review-main">
          <ReviewBranchDiagram steps={snapshot.steps} />
          <ReviewDecisionForm
            taskId={snapshot.taskId}
            steps={snapshot.steps}
            reviews={snapshot.reviews}
            currentUserId={props.currentUserId}
            onDecide={props.onDecide}
          />
        </div>
        <aside className="task-review-side">
          <ReviewQueue entries={snapshot.queue} onSelect={props.onSelectQueueEntry} />
        </aside>
      </div>
      <p className="task-review-legend">
        {snapshot.steps.map((step) => `${step.stepId}：${statusLabel(step.status)}`).join(" · ")}
      </p>
    </main>
  );
}

export type { ReviewActionError };
