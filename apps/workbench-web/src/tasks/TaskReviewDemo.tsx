import { useEffect, useState } from "react";

import { decideReview, fetchReviewQueue, fetchTaskReviewSnapshot } from "./workbenchReviewClient";
import { TaskReviewView } from "./TaskReviewView";
import type { TaskReviewSnapshot } from "./TaskReviewView";
import type { ReviewQueueEntry } from "./ReviewQueue";
import type { ReviewDecision } from "./ReviewDecisionForm";

/**
 * Demo host for the ticket 07 review surface. It reads the workbench app port over
 * HTTP; the API base defaults to same-origin (`/api`) behind the dev proxy.
 */
const API_BASE = "/api";
const TASK_ID = new URLSearchParams(window.location.search).get("task") ?? "task-025";
const CURRENT_USER_ID = "user-hr";

export function TaskReviewDemo() {
  const [snapshot, setSnapshot] = useState<TaskReviewSnapshot | null>(null);
  const [queue, setQueue] = useState<ReviewQueueEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // One fetch per change, not a polling loop: mutations re-read the snapshot directly.
    let cancelled = false;
    const load = async () => {
      try {
        const [nextSnapshot, nextQueue] = await Promise.all([
          fetchTaskReviewSnapshot(API_BASE, TASK_ID),
          fetchReviewQueue(API_BASE),
        ]);
        if (!cancelled) {
          setSnapshot(nextSnapshot);
          setQueue(nextQueue);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) setLoadError((error as Error).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onDecide = async (input: ReviewDecision) => {
    const reviewStep = snapshot?.steps.find((step) => step.status === "waitingReview");
    if (!snapshot || !reviewStep) return;
    await decideReview(API_BASE, {
      taskId: snapshot.taskId,
      stepId: reviewStep.stepId,
      ...input,
    });
    setSnapshot(await fetchTaskReviewSnapshot(API_BASE, TASK_ID));
    setQueue(await fetchReviewQueue(API_BASE));
  };

  if (loadError) return <p role="alert">加载失败：{loadError}</p>;
  if (!snapshot) return <p>加载中…</p>;
  return (
    <TaskReviewView
      snapshot={{ ...snapshot, queue }}
      currentUserId={CURRENT_USER_ID}
      onDecide={onDecide}
    />
  );
}
