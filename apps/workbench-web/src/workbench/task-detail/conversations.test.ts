import { describe, expect, it } from "vite-plus/test";

import { createConversationStore, type ChatMessage } from "./conversations";
import type { ConversationScope } from "./domain";

const assistant: ConversationScope = { taskId: "t25", kind: "project-assistant", stepId: null };
const reviewThread: ConversationScope = {
  taskId: "t25",
  kind: "step-thread",
  stepId: "step-review",
};
const otherTaskThread: ConversationScope = {
  taskId: "t24",
  kind: "step-thread",
  stepId: "step-review",
};

function userMessage(text: string): ChatMessage {
  return { id: `m-${text}`, role: "user", text, status: "sent" };
}

describe("conversation store", () => {
  it("keeps drafts per scope and restores them after switching away and back", () => {
    const store = createConversationStore();
    store.setDraft(assistant, "进度如何了");
    expect(store.draft(reviewThread)).toBe("");
    store.setDraft(reviewThread, "初审结论是什么");
    expect(store.draft(assistant)).toBe("进度如何了");
  });

  it("keeps messages isolated between scopes of different tasks and steps", () => {
    const store = createConversationStore();
    store.append(assistant, userMessage("进度如何了"));
    store.append(reviewThread, userMessage("初审结论是什么"));
    expect(store.messages(otherTaskThread)).toEqual([]);
    expect(store.messages(reviewThread).map((m) => m.text)).toEqual(["初审结论是什么"]);
  });

  it("rejects empty sends without mutating state", () => {
    const store = createConversationStore();
    expect(store.canSend(assistant, "  ")).toBe(false);
    store.append(assistant, userMessage("x"));
    expect(store.canSend(assistant, "")).toBe(false);
    expect(store.canSend(assistant, "重试")).toBe(true);
  });

  it("marks a failed send and retries the same message id in place", () => {
    const store = createConversationStore();
    store.append(assistant, { id: "m1", role: "user", text: "继续", status: "sent" });
    store.markFailed(assistant, "m1");
    expect(store.messages(assistant)[0]?.status).toBe("failed");
    expect(store.retryable(assistant)).toEqual(["m1"]);
    store.markSent(assistant, "m1");
    expect(store.messages(assistant)[0]?.status).toBe("sent");
    expect(store.retryable(assistant)).toEqual([]);
  });

  it("routes a late reply to its own scope, not the currently viewed one", () => {
    const store = createConversationStore();
    const late = {
      id: "r1",
      role: "assistant" as const,
      text: "已完成初审",
      status: "sent" as const,
    };
    store.append(otherTaskThread, late);
    expect(store.messages(assistant)).toEqual([]);
    expect(store.messages(otherTaskThread)).toEqual([late]);
  });

  it("tracks per-scope pending send state", () => {
    const store = createConversationStore();
    expect(store.isSending(assistant)).toBe(false);
    store.setSending(assistant, true);
    expect(store.isSending(assistant)).toBe(true);
    expect(store.isSending(reviewThread)).toBe(false);
    store.setSending(assistant, false);
    expect(store.isSending(assistant)).toBe(false);
  });
});
