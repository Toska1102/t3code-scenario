import type { ConversationScope, TaskDetailSnapshot, TaskStatus } from "./domain";
import type { ChatMessage } from "./conversations";
import type { TaskDetailEvent } from "./runtime";

export interface TaskSummary {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
}

export interface TeamInfo {
  readonly name: string;
  readonly description: string;
  readonly establishedAt: string;
  readonly nodeCount: number;
}

/**
 * Application ports for the task-detail surface. The UI only talks to these;
 * a real T3-backed adapter or an in-memory demo adapter plugs in at the mount
 * seam without the page knowing which.
 */
export interface TaskDetailSnapshotPort {
  /** Fetches the authoritative snapshot for exactly this task. */
  fetchSnapshot(taskId: string): Promise<TaskDetailSnapshot>;
}

export interface TaskDetailEventPort {
  /**
   * Subscribes to live events of one task. `onGap` reports a missed stretch
   * of the stream — the owner must refetch the snapshot instead of guessing.
   */
  subscribe(
    taskId: string,
    handlers: {
      onEvent: (event: TaskDetailEvent) => void;
      onGap: () => void;
      onTransportError: (message: string) => void;
    },
  ): { close(): void };
}

export interface ConversationPort {
  /** Reads the message history of exactly this conversation scope. */
  listMessages(scope: ConversationScope): Promise<readonly ChatMessage[]>;
  /** Sends a non-empty message in exactly this conversation scope. */
  sendMessage(scope: ConversationScope, text: string): Promise<{ messageId: string }>;
}

export interface TaskDetailPorts {
  readonly snapshot: TaskDetailSnapshotPort;
  readonly events: TaskDetailEventPort;
  readonly conversations: ConversationPort;
}
