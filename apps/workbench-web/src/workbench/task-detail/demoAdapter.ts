import type { ConversationScope, TaskDetailSnapshot } from "./domain";
import { conversationScopeKey } from "./domain";
import type { ChatMessage } from "./conversations";
import type { DemoProject } from "./fixtures";
import type { TaskDetailEvent } from "./runtime";
import type { TaskDetailPorts } from "./ports";

export interface DemoTestPorts extends TaskDetailPorts {
  readonly snapshots: Map<string, TaskDetailSnapshot>;
  /** Test hook: push a live event into the stream of one task. */
  emitEvent(taskId: string, event: TaskDetailEvent): void;
  /** Test hook: report a missed stretch of the stream for one task. */
  emitGap(taskId: string): void;
  /** Test hook: inject a message into one conversation scope. */
  appendMessage(
    scope: ConversationScope,
    message: {
      id: string;
      role: "user" | "assistant";
      text: string;
      status?: ChatMessage["status"];
    },
  ): void;
  /** Test hook: make the next snapshot fetch fail with this message. */
  failNextSnapshot(message: string): void;
}

interface Subscription {
  onEvent: (event: TaskDetailEvent) => void;
  onGap: () => void;
  onTransportError: (message: string) => void;
}

/**
 * In-memory demo adapter implementing the task-detail ports over the design
 * fixtures. This is the mount-seam adapter a real T3-backed implementation
 * replaces; the page only knows the port interfaces.
 */
export function createDemoPorts(demo: DemoProject): DemoTestPorts {
  const snapshots = new Map(demo.snapshots);
  const subscriptions = new Map<string, Set<Subscription>>();
  const scopeMessages = new Map<string, ChatMessage[]>();
  const failingSnapshot: string[] = [];
  let messageSeq = 0;

  const emit = (taskId: string, event: TaskDetailEvent) => {
    for (const subscription of subscriptions.get(taskId) ?? []) subscription.onEvent(event);
  };

  const ports: DemoTestPorts = {
    snapshots,
    snapshot: {
      async fetchSnapshot(taskId) {
        if (failingSnapshot.length > 0) throw new Error(failingSnapshot.shift());
        const snapshot = snapshots.get(taskId);
        if (!snapshot) throw new Error(`未找到任务 ${taskId}`);
        return snapshot;
      },
    },
    events: {
      subscribe(taskId, handlers) {
        const set = subscriptions.get(taskId) ?? new Set<Subscription>();
        set.add(handlers);
        subscriptions.set(taskId, set);
        return {
          close() {
            set.delete(handlers);
          },
        };
      },
    },
    conversations: {
      async listMessages(scope) {
        return scopeMessages.get(conversationScopeKey(scope)) ?? [];
      },
      async sendMessage(scope, text) {
        messageSeq += 1;
        void scope;
        return { messageId: `dm-${messageSeq}-${text.length}` };
      },
    },
    emitEvent: emit,
    emitGap(taskId) {
      for (const subscription of subscriptions.get(taskId) ?? []) subscription.onGap();
    },
    appendMessage(scope, message) {
      // Route strictly by conversation scope; a different scope is a different conversation.
      const key = conversationScopeKey(scope);
      const bucket = scopeMessages.get(key) ?? [];
      bucket.push({ status: "sent", ...message });
      scopeMessages.set(key, bucket);
      emit(scope.taskId, {
        type: "conversation-message",
        scope,
        message: { status: "sent", ...message },
      });
    },
    failNextSnapshot(message) {
      failingSnapshot.push(message);
    },
  };

  return ports;
}
