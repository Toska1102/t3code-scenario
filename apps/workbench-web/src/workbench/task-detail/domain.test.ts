import { describe, expect, it } from "vite-plus/test";

import {
  activityStep,
  activitiesForStep,
  conversationScopeKey,
  sameConversationScope,
  type ActivityItem,
  type ConversationScope,
} from "./domain";

function activity(partial: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    kind: "step",
    title: "完成初审简历",
    time: "16:24",
    actor: "招聘 / Codex",
    stepId: "step-review",
    ...partial,
  };
}

describe("conversation scoping", () => {
  it("keys conversations by exact task, kind and step", () => {
    const projectAssistant: ConversationScope = {
      taskId: "t25",
      kind: "project-assistant",
      stepId: null,
    };
    const stepThread: ConversationScope = {
      taskId: "t25",
      kind: "step-thread",
      stepId: "step-review",
    };
    expect(conversationScopeKey(projectAssistant)).toBe("t25::project-assistant::-");
    expect(conversationScopeKey(stepThread)).toBe("t25::step-thread::step-review");
    expect(sameConversationScope(projectAssistant, stepThread)).toBe(false);
  });

  it("never matches scopes across tasks even when kind, step and time are identical", () => {
    const taskA: ConversationScope = { taskId: "t25", kind: "step-thread", stepId: "step-review" };
    const taskB: ConversationScope = { taskId: "t24", kind: "step-thread", stepId: "step-review" };
    expect(sameConversationScope(taskA, taskB)).toBe(false);
    expect(conversationScopeKey(taskA)).not.toBe(conversationScopeKey(taskB));
  });

  it("treats a null step and a set step as different scopes within one task", () => {
    const observer: ConversationScope = { taskId: "t25", kind: "observer", stepId: null };
    const bound: ConversationScope = { taskId: "t25", kind: "observer", stepId: "step-review" };
    expect(sameConversationScope(observer, bound)).toBe(false);
  });
});

describe("activity ↔ step mapping", () => {
  const stepIds = new Set(["step-standards", "step-review"]);

  it("maps an activity to its explicitly linked step", () => {
    const linked = activity({ id: "a1", stepId: "step-review" });
    expect(activityStep(linked, stepIds)).toBe("step-review");
  });

  it("reports an activity without a link as unlinked, never by guessing from time or actor", () => {
    const unlinked = activity({ id: "a2", stepId: null, time: "16:24", actor: "招聘 / Codex" });
    expect(activityStep(unlinked, stepIds)).toBeNull();
  });

  it("reports an activity linked to an unknown step as unlinked for this task", () => {
    const foreign = activity({ id: "a3", stepId: "step-from-another-task" });
    expect(activityStep(foreign, stepIds)).toBeNull();
  });

  it("lists only activities that belong to the requested step of this task", () => {
    const activities = [
      activity({ id: "a1", stepId: "step-review" }),
      activity({ id: "a2", stepId: "step-standards" }),
      activity({ id: "a3", stepId: null }),
      activity({ id: "a4", stepId: "step-review" }),
    ];
    expect(activitiesForStep(activities, "step-review").map((a) => a.id)).toEqual(["a1", "a4"]);
  });
});
