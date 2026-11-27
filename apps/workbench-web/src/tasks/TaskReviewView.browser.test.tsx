import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { TaskReviewView } from "./TaskReviewView";
import type { TaskReviewSnapshot } from "./TaskReviewView";
import type { WorkbenchReviewRecord } from "../../../../packages/workbench-core/src/tasks/workbenchReviewMemoryStore";

function waitingSnapshot(): TaskReviewSnapshot {
  const reviews: WorkbenchReviewRecord[] = [
    {
      taskId: "task-025",
      stepId: "复核审核建议",
      attempt: 1,
      status: "open",
      assignedReviewerId: "user-hr",
    },
  ];
  return {
    taskId: "task-025",
    title: "产品经理岗简历审核 #025",
    steps: [
      {
        stepId: "明确岗位审核标准",
        dependsOn: [],
        executor: "OD / Claude Code",
        status: "succeeded",
      },
      {
        stepId: "初审简历",
        dependsOn: ["明确岗位审核标准"],
        executor: "招聘 / Codex",
        status: "succeeded",
      },
      {
        stepId: "汇总待核实项",
        dependsOn: ["明确岗位审核标准"],
        executor: "招聘 / Codex",
        status: "succeeded",
      },
      {
        stepId: "复核审核建议",
        dependsOn: ["初审简历", "汇总待核实项"],
        executor: "HR 总管",
        status: "waitingReview",
        reviewerId: "user-hr",
      },
    ],
    reviews,
    queue: [
      {
        taskId: "task-025",
        stepId: "复核审核建议",
        attempt: 1,
        assignedReviewerId: "user-hr",
        executor: "HR 总管",
      },
    ],
  };
}

function decidedSnapshot(status: "approved" | "returned", deputy: string): TaskReviewSnapshot {
  const snapshot = waitingSnapshot();
  return {
    ...snapshot,
    steps: snapshot.steps.map((step) =>
      step.stepId === "复核审核建议" ? { ...step, status, reviewerId: "user-hr" } : step,
    ),
    reviews: [
      {
        taskId: "task-025",
        stepId: "复核审核建议",
        attempt: 1,
        status,
        assignedReviewerId: "user-hr",
        decidedByActorId: deputy,
        decidedAt: "2026-11-27T16:24:00.000Z",
        ...(status === "returned" ? { reason: "漏了必答项", returnToStepId: "初审简历" } : {}),
      },
    ],
    queue: [],
  };
}

describe("task review view", () => {
  it("exposes the waiting state as an accessible decision form", async () => {
    await using screen = await render(
      <TaskReviewView
        snapshot={waitingSnapshot()}
        currentUserId="user-hr"
        onDecide={async () => {}}
      />,
    );
    await expect.element(screen.getByRole("region", { name: "待我处理" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /任务 task-025 步骤 复核审核建议/ }))
      .toBeVisible();
    await expect.element(screen.getByLabelText("退回原因（必填）")).toBeVisible();
    await expect.element(screen.getByLabelText("返工目标")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "通过" })).toBeEnabled();
    // The return button stays inert until reason and target are filled.
    await expect.element(screen.getByRole("button", { name: "退回" })).toBeDisabled();
  });

  it("previews the affected downstream for the chosen rework target", async () => {
    await using screen = await render(
      <TaskReviewView
        snapshot={waitingSnapshot()}
        currentUserId="user-hr"
        onDecide={async () => {}}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("返工目标"), "初审简历");
    await expect.element(screen.getByText(/受影响下游：复核审核建议/)).toBeVisible();
  });

  it("marks a deputy acting on someone else's review", async () => {
    await using screen = await render(
      <TaskReviewView
        snapshot={waitingSnapshot()}
        currentUserId="user-admin"
        onDecide={async () => {}}
      />,
    );
    await expect.element(screen.getByText(/代办 · 指定负责人 user-hr/)).toBeVisible();
  });

  it("shows the decided record with both reviewer identities", async () => {
    await using screen = await render(
      <TaskReviewView
        snapshot={decidedSnapshot("returned", "user-deputy")}
        currentUserId="user-hr"
        onDecide={async () => {}}
      />,
    );
    const region = screen.getByRole("region", { name: "评审" });
    await expect.element(region).toBeVisible();
    await expect.element(screen.getByText("user-hr")).toBeVisible();
    await expect.element(screen.getByText("user-deputy")).toBeVisible();
    await expect.element(screen.getByText("漏了必答项")).toBeVisible();
    await expect.element(screen.getByText("已退回")).toBeVisible();
  });

  it("submits an approval from the waiting state", async () => {
    const decisions: string[] = [];
    await using screen = await render(
      <TaskReviewView
        snapshot={waitingSnapshot()}
        currentUserId="user-hr"
        onDecide={async (input) => {
          decisions.push(input.decision);
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "通过" }));
    expect(decisions).toEqual(["approve"]);
  });
});
