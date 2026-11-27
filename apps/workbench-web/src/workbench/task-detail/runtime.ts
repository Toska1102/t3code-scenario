import type {
  ActivityItem,
  AgentTrailStatus,
  ConversationScope,
  StepStatus,
  TaskDetailSnapshot,
} from "./domain";
import type { ChatMessage } from "./conversations";

export type TaskDetailEvent =
  | { type: "step-status"; taskId: string; stepId: string; status: StepStatus }
  | { type: "activity-appended"; taskId?: string; activity: ActivityItem }
  | { type: "conversation-message"; scope: ConversationScope; message: ChatMessage }
  | { type: "agent-trail-unavailable"; reason: string }
  | { type: "agent-trail-recovered" };

export interface TaskRuntimeState {
  readonly taskId: string;
  readonly phase: "idle" | "loading" | "ready" | "failed";
  readonly snapshot: TaskDetailSnapshot | null;
  /** Set when the event stream reported a gap; the owner must refetch the snapshot. */
  readonly resyncRequested: boolean;
  readonly transportError: string | null;
}

export function initialTaskRuntime(taskId: string): TaskRuntimeState {
  return { taskId, phase: "idle", snapshot: null, resyncRequested: false, transportError: null };
}

/**
 * Pure state transitions for one task's detail runtime. Events tagged with a
 * `taskId` that differs from this runtime's task are dropped — cross-task
 * traffic must never mutate this task's state.
 */
export type TaskRuntimeAction =
  | { type: "snapshot-loading" }
  | { type: "snapshot-loaded"; snapshot: TaskDetailSnapshot }
  | { type: "transport-failed"; message: string }
  | { type: "stream-gap" }
  | TaskDetailEvent;

export function reduceTaskRuntime(
  state: TaskRuntimeState,
  action: TaskRuntimeAction,
): TaskRuntimeState {
  switch (action.type) {
    case "snapshot-loading":
      return { ...state, phase: state.snapshot ? state.phase : "loading", transportError: null };
    case "snapshot-loaded":
      return {
        ...state,
        phase: "ready",
        snapshot: action.snapshot,
        resyncRequested: false,
        transportError: null,
      };
    case "transport-failed":
      return { ...state, phase: "failed", transportError: action.message };
    case "stream-gap":
      // A missed stretch of events is recovered by refetching the snapshot,
      // never by patching local state with guesses.
      return { ...state, resyncRequested: true };
    case "conversation-message":
      // Conversation state is stored per scope outside the runtime; the page
      // routes this into the conversation store, which keys by exact scope.
      return state;
    case "agent-trail-unavailable":
      return state.snapshot
        ? {
            ...state,
            snapshot: {
              ...state.snapshot,
              agentTrail: { available: false, reason: action.reason } satisfies AgentTrailStatus,
            },
          }
        : state;
    case "agent-trail-recovered":
      return state.snapshot
        ? { ...state, snapshot: { ...state.snapshot, agentTrail: { available: true } } }
        : state;
    case "step-status": {
      if (action.taskId !== state.taskId || !state.snapshot) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          graph: {
            ...state.snapshot.graph,
            steps: state.snapshot.graph.steps.map((step) =>
              step.id === action.stepId ? { ...step, status: action.status } : step,
            ),
          },
        },
      };
    }
    case "activity-appended": {
      if (!state.snapshot) return state;
      // An activity tagged with another task's id stays out of this task's feed.
      if (action.taskId !== undefined && action.taskId !== state.taskId) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          activities: [...state.snapshot.activities, action.activity],
        },
      };
    }
  }
}
