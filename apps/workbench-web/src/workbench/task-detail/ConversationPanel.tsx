import type { ConversationDescriptor, ConversationScope } from "./domain";
import { conversationScopeKey } from "./domain";
import type { ConversationStore } from "./conversations";
import { cn } from "./cn";

/**
 * The 会话 section: conversation switcher, message list and composer. All
 * state is keyed by exact conversation scope, so drafts, messages and late
 * replies stay with the conversation they belong to.
 */
export function ConversationPanel({
  conversations,
  activeScopeKey,
  onScopeChange,
  store,
  composerPlaceholder,
  onDraftChange,
  onSend,
  onRetry,
}: {
  conversations: readonly ConversationDescriptor[];
  activeScopeKey: string;
  onScopeChange: (scope: ConversationScope) => void;
  store: ConversationStore;
  composerPlaceholder: string;
  onDraftChange: () => void;
  onSend: (scope: ConversationScope, text: string) => void;
  onRetry: (scope: ConversationScope, messageId: string, text: string) => void;
}) {
  const active =
    conversations.find((c) => conversationScopeKey(c.scope) === activeScopeKey) ?? conversations[0];
  if (!active) return null;
  const messages = store.messages(active.scope);
  const draft = store.draft(active.scope);
  const sending = store.isSending(active.scope);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between pt-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-[#F3F4F7]">会话</h3>
          <select
            aria-label="切换会话"
            value={activeScopeKey}
            onChange={(event) => {
              const next = conversations.find(
                (c) => conversationScopeKey(c.scope) === event.target.value,
              );
              if (next) onScopeChange(next.scope);
            }}
            className="rounded-md border border-[#2A384B] bg-[#101A29] px-3 py-1.5 text-sm text-[#F3F4F7]"
          >
            {conversations.map((conversation) => (
              <option
                key={conversationScopeKey(conversation.scope)}
                value={conversationScopeKey(conversation.scope)}
              >
                {conversation.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-[#9AA8BC]">切换任务时，进度、活动、评审与会话一起切换</p>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto">
        {messages.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[70%] rounded-lg px-3 py-2 text-sm",
                message.role === "user"
                  ? "bg-[#14324A] text-[#F3F4F7]"
                  : "border border-[#2A384B] bg-[#101A29] text-[#F3F4F7]",
                message.status === "failed" && "border-red-400/70",
              )}
            >
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.status === "failed" ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-red-300">发送失败</span>
                  <button
                    type="button"
                    onClick={() => onRetry(active.scope, message.id, message.text)}
                    className="rounded-md border border-[#2A384B] px-2 py-0.5 text-xs text-[#F3F4F7] hover:bg-[#16233A]"
                  >
                    重试
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-3 border-t border-[#2A384B] py-4">
        <textarea
          value={draft}
          placeholder={composerPlaceholder}
          onChange={(event) => {
            store.setDraft(active.scope, event.target.value);
            onDraftChange();
          }}
          rows={2}
          className="min-h-11 flex-1 resize-none rounded-lg border border-[#2A384B] bg-[#101A29] px-4 py-3 text-sm text-[#F3F4F7] placeholder:text-[#9AA8BC]"
        />
        <button
          type="button"
          disabled={!store.canSend(active.scope, draft)}
          onClick={() => onSend(active.scope, draft)}
          className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-medium text-[#0A0F1A] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </section>
  );
}
