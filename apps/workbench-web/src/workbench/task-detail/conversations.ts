import { conversationScopeKey, type ConversationScope } from "./domain";

/**
 * Conversation state keyed by exact conversation scope. Drafts, messages and
 * pending-send flags live per scope, so switching tasks or conversations never
 * bleeds state, and late replies are stored under the scope they belong to.
 */
export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly status: "sent" | "pending" | "failed";
}

interface ScopeState {
  readonly draft: string;
  readonly messages: readonly ChatMessage[];
  readonly sending: boolean;
}

const emptyState: ScopeState = { draft: "", messages: [], sending: false };

export function createConversationStore() {
  const states = new Map<string, ScopeState>();

  const of = (scope: ConversationScope): ScopeState =>
    states.get(conversationScopeKey(scope)) ?? emptyState;

  return {
    draft: (scope: ConversationScope): string => of(scope).draft,
    messages: (scope: ConversationScope): readonly ChatMessage[] => of(scope).messages,
    isSending: (scope: ConversationScope): boolean => of(scope).sending,

    setDraft(scope: ConversationScope, draft: string): void {
      const state = of(scope);
      states.set(conversationScopeKey(scope), { ...state, draft });
    },

    canSend(scope: ConversationScope, text: string): boolean {
      return text.trim().length > 0 && !of(scope).sending;
    },

    setSending(scope: ConversationScope, sending: boolean): void {
      const state = of(scope);
      states.set(conversationScopeKey(scope), { ...state, sending });
    },

    append(scope: ConversationScope, message: ChatMessage): void {
      const state = of(scope);
      states.set(conversationScopeKey(scope), { ...state, messages: [...state.messages, message] });
    },

    markFailed(scope: ConversationScope, messageId: string): void {
      this.setStatus(scope, messageId, "failed");
    },

    markSent(scope: ConversationScope, messageId: string): void {
      this.setStatus(scope, messageId, "sent");
    },

    retryable(scope: ConversationScope): readonly string[] {
      return of(scope)
        .messages.filter((message) => message.status === "failed")
        .map((message) => message.id);
    },

    replaceMessages(scope: ConversationScope, messages: readonly ChatMessage[]): void {
      const state = of(scope);
      states.set(conversationScopeKey(scope), { ...state, messages });
    },

    setStatus(scope: ConversationScope, messageId: string, status: ChatMessage["status"]): void {
      const key = conversationScopeKey(scope);
      const state = states.get(key);
      if (!state) return;
      states.set(key, {
        ...state,
        messages: state.messages.map((message) =>
          message.id === messageId ? { ...message, status } : message,
        ),
      });
    },
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
