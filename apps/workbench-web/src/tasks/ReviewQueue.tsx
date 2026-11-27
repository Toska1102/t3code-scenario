import "./workbenchReview.css";

export interface ReviewQueueEntry {
  taskId: string;
  stepId: string;
  attempt: number;
  assignedReviewerId: string;
  executor: string;
}

export function ReviewQueue(props: {
  entries: readonly ReviewQueueEntry[];
  onSelect?: ((entry: ReviewQueueEntry) => void) | undefined;
}) {
  return (
    <section className="review-queue" aria-label="待我处理">
      <h3>
        待我处理 <span className="review-count">{props.entries.length}</span>
      </h3>
      {props.entries.length === 0 ? (
        <p className="review-empty">没有待处理的评审。</p>
      ) : (
        <ul>
          {props.entries.map((entry) => (
            <li key={`${entry.taskId}-${entry.stepId}-${entry.attempt}`}>
              <button
                type="button"
                onClick={() => props.onSelect?.(entry)}
                aria-label={`任务 ${entry.taskId} 步骤 ${entry.stepId} 第 ${entry.attempt} 次产出 待评审`}
              >
                <span className="review-queue-task">{entry.taskId}</span>
                <span className="review-queue-step">
                  {entry.stepId} · {entry.executor}
                </span>
                <span className="review-queue-attempt">#{entry.attempt}</span>
                <span className="review-queue-status">待评审</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
