import { describe, expect, it } from "vite-plus/test";

import { deriveResultPanelState, type ResultPanelInput } from "./resultPanel.ts";

function savedReceipt() {
  return {
    deliveryId: "wbdlv-a",
    taskId: "task-025",
    attemptId: "attempt-1",
    state: "saved" as const,
    summary: "经复核的候选人建议",
    files: [
      { materialId: "wbmat-1", name: "建议.pdf", mimeType: "application/pdf", sizeBytes: 128 },
    ],
    savedAt: "2026-11-27T00:00:00.000Z",
  };
}

function pendingReceipt() {
  return { ...savedReceipt(), state: "pending-delivery" as const, failureReason: "disk full" };
}

describe("deriveResultPanelState", () => {
  it("running tasks show stage outputs and no formal delivery", () => {
    const state = deriveResultPanelState({ taskStatus: "running", stageOutputs: ["初审完成"] });
    expect(state.kind).toBe("in-progress");
    if (state.kind === "in-progress") expect(state.stageOutputs).toEqual(["初审完成"]);
  });

  it("completed steps with pending save show 正在保存结果 until the formal result lands", () => {
    const state = deriveResultPanelState({ taskStatus: "running", stepsCompleted: true });
    expect(state.kind).toBe("saving-result");
  });

  it("a save failure shows 待处理 with a retry of the same formal result (D06/D07)", () => {
    const state = deriveResultPanelState({
      taskStatus: "running",
      stepsCompleted: true,
      receipt: pendingReceipt(),
    });
    expect(state.kind).toBe("pending-delivery");
    if (state.kind === "pending-delivery") {
      expect(state.failureReason).toBe("disk full");
      expect(state.retry.deliveryId).toBe("wbdlv-a");
    }
  });

  it("completion requires a saved formal result (A03)", () => {
    const completedWithPending = deriveResultPanelState({
      taskStatus: "completed",
      receipt: pendingReceipt(),
    });
    // A completed task can never rest on a pending delivery: surface the inconsistency
    // as pending-delivery so the panel keeps the retry affordance.
    expect(completedWithPending.kind).toBe("pending-delivery");
  });

  it("a completed task shows the formal delivery with files", () => {
    const state = deriveResultPanelState({ taskStatus: "completed", receipt: savedReceipt() });
    expect(state.kind).toBe("completed");
    if (state.kind === "completed") {
      expect(state.summary).toBe("经复核的候选人建议");
      expect(state.files).toHaveLength(1);
      expect(state.statusLabel).toBe("已完成");
    }
  });

  it("a read failure on a completed task keeps completion and offers retry read (D11)", () => {
    const input: ResultPanelInput = {
      taskStatus: "completed",
      receipt: savedReceipt(),
      readError: "storage unavailable",
    };
    const state = deriveResultPanelState(input);
    expect(state.kind).toBe("completed");
    if (state.kind === "completed") {
      expect(state.statusLabel).toBe("已完成");
      expect(state.readError).toBe("storage unavailable");
      expect(state.retryRead).toBe(true);
    }
  });
});
