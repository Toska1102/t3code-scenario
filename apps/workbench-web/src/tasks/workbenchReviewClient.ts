import type { ReviewDecision } from "./ReviewDecisionForm";
import type { ReviewQueueEntry } from "./ReviewQueue";
import type { TaskReviewSnapshot } from "./TaskReviewView";

/**
 * Thin HTTP client for the workbench review app port. Mount points:
 * - `GET  /workbench/review/queue`    → personal pending queue
 * - `POST /workbench/review/decisions` → compare-and-set review decision
 * The server derives the actor from the session; the payload never carries it.
 */
export async function fetchReviewQueue(baseUrl: string): Promise<ReviewQueueEntry[]> {
  const response = await fetch(`${baseUrl}/workbench/review/queue`, { credentials: "include" });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "无法读取待办列表");
  return body.reviews;
}

export async function decideReview(
  baseUrl: string,
  input: ReviewDecision & { taskId: string; stepId: string; attempt: number },
): Promise<void> {
  const response = await fetch(`${baseUrl}/workbench/review/decisions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) {
    throw { code: body?.error?.code ?? "unknown", message: body?.error?.message ?? "操作失败" };
  }
}

export async function fetchTaskReviewSnapshot(
  baseUrl: string,
  taskId: string,
): Promise<TaskReviewSnapshot> {
  const response = await fetch(`${baseUrl}/workbench/review/tasks/${taskId}`, {
    credentials: "include",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "无法读取任务");
  const task = body.task;
  return {
    taskId,
    title: `${taskId} 运行进度`,
    steps: task.task.steps.map(
      (step: { stepId: string; dependsOn: string[]; executor: string }) => ({
        ...step,
        status: task.stepRuns[step.stepId].status,
      }),
    ),
    reviews: task.reviews,
    queue: [],
  };
}
