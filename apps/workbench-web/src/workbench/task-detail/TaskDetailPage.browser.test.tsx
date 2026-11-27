import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test-support/render";
import { buildDemoProject } from "./fixtures";
import { createDemoPorts, type DemoTestPorts } from "./demoAdapter";
import { TaskDetailPage, type TaskDetailPageProps } from "./TaskDetailPage";

/**
 * The page is a controlled surface: the owner of the task rail decides which
 * task is selected. This harness plays that owner so tests can switch tasks
 * the way the real project page does.
 */
function TaskSelectionHarness(
  props: Omit<TaskDetailPageProps, "selectedTaskId" | "onSelectTask"> & { initialTaskId: string },
) {
  const [taskId, setTaskId] = useState(props.initialTaskId);
  return <TaskDetailPage {...props} selectedTaskId={taskId} onSelectTask={setTaskId} />;
}

async function setup(portsOverride?: (ports: DemoTestPorts) => void, harness: boolean = false) {
  const demo = buildDemoProject();
  const ports = createDemoPorts(demo);
  portsOverride?.(ports);
  const page = harness ? (
    <TaskSelectionHarness
      projectName={demo.projectName}
      team={demo.team}
      tasks={demo.tasks}
      initialTaskId="t25"
      ports={ports}
      onBackToProject={vi.fn()}
      onOpenAgentConnections={vi.fn()}
    />
  ) : (
    <TaskDetailPage
      projectName={demo.projectName}
      team={demo.team}
      tasks={demo.tasks}
      selectedTaskId="t25"
      onSelectTask={vi.fn()}
      ports={ports}
      onBackToProject={vi.fn()}
      onOpenAgentConnections={vi.fn()}
    />
  );
  const screen = await render(page);
  // Wait for the snapshot round-trip so tests observe a ready page.
  await expect.element(screen.getByText("已完成 · 4 / 4 步完成")).toBeInTheDocument();
  return {
    demo,
    ports,
    screen,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
    },
  };
}

function composerOf(screen: { container: HTMLElement }) {
  // The page renders exactly one composer textarea.
  return screen.container.querySelector("textarea") as HTMLTextAreaElement;
}

describe("TaskDetailPage (04.01)", () => {
  it("renders the design layout: top bar, team rail, task rail, graph, activity feed and conversation", async () => {
    await using setupResult = await setup();
    const { screen } = setupResult;
    await expect.element(screen.getByText("返回项目详情")).toBeInTheDocument();
    await expect.element(screen.getByText("Agent 连接")).toBeInTheDocument();
    await expect.element(screen.getByText("产品经理简历审核 #025").first()).toBeInTheDocument();
    // Step graph nodes
    await expect.element(screen.getByText("明确岗位审核标准")).toBeInTheDocument();
    await expect.element(screen.getByText("初审简历")).toBeInTheDocument();
    await expect.element(screen.getByText("汇总待核事项")).toBeInTheDocument();
    await expect.element(screen.getByText("复核审核建议")).toBeInTheDocument();
    // Activity feed
    await expect.element(screen.getByText("#025 运行活动")).toBeInTheDocument();
    await expect.element(screen.getByText("完成初审简历")).toBeInTheDocument();
    // Conversation section
    await expect.element(screen.getByText("会话")).toBeInTheDocument();
    await expect.element(screen.getByText("发送")).toBeInTheDocument();
  });

  it("selects the step an activity belongs to when the activity is clicked", async () => {
    await using setupResult = await setup();
    const { screen } = setupResult;
    const user = userEvent.setup();
    await user.click(screen.getByText("完成初审简历"));
    const stepNode = screen.container.querySelector('[data-step-id="step-review"]');
    expect(stepNode?.getAttribute("data-selected")).toBe("true");
  });

  it("shows why an unlinked activity cannot jump to a step", async () => {
    await using setupResult = await setup();
    const { screen } = setupResult;
    const unlinked = screen.container.querySelector('[data-activity-id="a5"]');
    expect(unlinked?.tagName).toBe("SPAN");
    expect(unlinked?.textContent).toContain("活动未关联步骤");
    // Linked activities stay clickable buttons.
    expect(screen.container.querySelector('[data-activity-id="a2"]')?.tagName).toBe("BUTTON");
  });

  it("keeps each task's graph, activities and conversations isolated when switching tasks", async () => {
    await using setupResult = await setup(undefined, true);
    const { screen } = setupResult;
    const user = userEvent.setup();
    await user.click(screen.getByText("产品经理简历审核 #024").first());
    await expect.element(screen.getByText("待评审 · 2 / 4 步完成")).toBeInTheDocument();
    // t24 has no 完成汇总待核事项 activity yet
    expect(screen.container.querySelector('[data-activity-id="a3"]')).toBeNull();
    // conversation switcher only offers t24's scopes
    const options = [...screen.container.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["项目助手 · #024", "只读观察"]);
  });

  it("preserves per-conversation drafts across conversation and task switches", async () => {
    const demo = buildDemoProject();
    const ports = createDemoPorts(demo);
    await using screen = await render(
      <TaskDetailPage
        projectName={demo.projectName}
        team={demo.team}
        tasks={demo.tasks}
        selectedTaskId="t25"
        onSelectTask={vi.fn()}
        ports={ports}
        onBackToProject={vi.fn()}
        onOpenAgentConnections={vi.fn()}
      />,
    );
    await expect.element(screen.getByText("已完成 · 4 / 4 步完成")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholder("询问或补充 #025 的任务材料..."), "进度如何了");
    // switch to the step thread, draft is empty there
    await user.selectOptions(screen.getByRole("combobox"), "步骤线程 · 初审简历");
    expect(composerOf(screen).value).toBe("");
    await user.type(screen.getByPlaceholder("询问或补充 #025 的任务材料..."), "初审结论是什么");
    // back to the project assistant, draft restored
    await user.selectOptions(screen.getByRole("combobox"), "项目助手 · #025");
    expect(composerOf(screen).value).toBe("进度如何了");
  });

  it("sends a non-empty message, blocks empty sends and offers retry on failure", async () => {
    const demo = buildDemoProject();
    const ports = createDemoPorts(demo);
    const sendSpy = vi.spyOn(ports.conversations, "sendMessage");
    sendSpy.mockRejectedValueOnce(new Error("发送失败"));
    await using screen = await render(
      <TaskDetailPage
        projectName={demo.projectName}
        team={demo.team}
        tasks={demo.tasks}
        selectedTaskId="t25"
        onSelectTask={vi.fn()}
        ports={ports}
        onBackToProject={vi.fn()}
        onOpenAgentConnections={vi.fn()}
      />,
    );
    await expect.element(screen.getByText("已完成 · 4 / 4 步完成")).toBeInTheDocument();
    const user = userEvent.setup();
    const send = () => screen.getByText("发送").element() as unknown as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    await user.type(screen.getByPlaceholder("询问或补充 #025 的任务材料..."), "进度如何了");
    expect(send().disabled).toBe(false);
    await user.click(screen.getByText("发送"));
    await expect.element(screen.getByText("进度如何了")).toBeInTheDocument();
    expect(sendSpy).toHaveBeenCalledWith(
      { taskId: "t25", kind: "project-assistant", stepId: null },
      "进度如何了",
    );
    // failed send shows retry in place
    await expect.element(screen.getByText("重试")).toBeInTheDocument();
    sendSpy.mockResolvedValueOnce({ messageId: "m2" });
    await user.click(screen.getByText("重试"));
    expect(sendSpy).toHaveBeenLastCalledWith(
      { taskId: "t25", kind: "project-assistant", stepId: null },
      "进度如何了",
    );
  });

  it("routes a late reply to its own conversation, not the one being viewed", async () => {
    await using setupResult = await setup(undefined, true);
    const { ports, screen } = setupResult;
    const user = userEvent.setup();
    ports.appendMessage(
      { taskId: "t24", kind: "project-assistant", stepId: null },
      {
        id: "late-1",
        role: "assistant",
        text: "t24 的迟到回复",
        status: "sent",
      },
    );
    // not visible in t25's current conversation
    expect(screen.container.textContent).not.toContain("t24 的迟到回复");
    await user.click(screen.getByText("产品经理简历审核 #024").first());
    await expect.element(screen.getByText("待评审 · 2 / 4 步完成")).toBeInTheDocument();
    await expect.element(screen.getByText("t24 的迟到回复")).toBeInTheDocument();
  });

  it("refetches the snapshot after a stream gap", async () => {
    await using setupResult = await setup();
    const { ports, screen } = setupResult;
    const fetchSpy = vi.spyOn(ports.snapshot, "fetchSnapshot");
    const activity = {
      id: "gap-1",
      kind: "step" as const,
      title: "断档期间完成的活动",
      time: "16:30",
      actor: "招聘 / Codex",
      stepId: "step-review",
    };
    ports.snapshots.set("t25", {
      ...ports.snapshots.get("t25")!,
      activities: [...ports.snapshots.get("t25")!.activities, activity],
    });
    ports.emitGap("t25");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect.element(screen.getByText("断档期间完成的活动")).toBeInTheDocument();
  });

  it("degrades gracefully when AgentTrail is unavailable and retries on demand", async () => {
    await using setupResult = await setup();
    const { ports, screen } = setupResult;
    const fetchSpy = vi.spyOn(ports.snapshot, "fetchSnapshot");
    ports.emitEvent("t25", { type: "agent-trail-unavailable", reason: "AgentTrail 扩展未连接" });
    await expect.element(screen.getByText("AgentTrail 扩展未连接")).toBeInTheDocument();
    // task graph and conversation stay visible
    await expect.element(screen.getByText("初审简历")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText("重试 AgentTrail"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect.element(screen.getByText("AgentTrail 扩展未连接")).not.toBeInTheDocument();
  });

  it("shows a transport failure with retry and recovers when the fetch succeeds", async () => {
    const demo = buildDemoProject();
    const ports = createDemoPorts(demo);
    ports.failNextSnapshot("连接中断");
    await using screen = await render(
      <TaskDetailPage
        projectName={demo.projectName}
        team={demo.team}
        tasks={demo.tasks}
        selectedTaskId="t25"
        onSelectTask={vi.fn()}
        ports={ports}
        onBackToProject={vi.fn()}
        onOpenAgentConnections={vi.fn()}
      />,
    );
    await expect.element(screen.getByText("暂时无法加载任务：连接中断")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText("重试"));
    await expect.element(screen.getByText("已完成 · 4 / 4 步完成")).toBeInTheDocument();
    await expect.element(screen.getByText("暂时无法加载任务：连接中断")).not.toBeInTheDocument();
  });

  it("renders provided review and results slots", async () => {
    const demo = buildDemoProject();
    const ports = createDemoPorts(demo);
    await using screen = await render(
      <TaskDetailPage
        projectName={demo.projectName}
        team={demo.team}
        tasks={demo.tasks}
        selectedTaskId="t25"
        onSelectTask={vi.fn()}
        ports={ports}
        onBackToProject={vi.fn()}
        onOpenAgentConnections={vi.fn()}
        reviewSlot={<div>评审槽位内容</div>}
        resultsSlot={<div>结果槽位内容</div>}
      />,
    );
    await expect.element(screen.getByText("评审槽位内容")).toBeInTheDocument();
    await expect.element(screen.getByText("结果槽位内容")).toBeInTheDocument();
  });

  it("filters the activity rail to the selected step and clears back to all activities", async () => {
    await using setupResult = await setup();
    const { screen } = setupResult;
    const user = userEvent.setup();
    // Select the review step from the graph: the rail focuses that step's activity.
    await user.click(screen.getByText("复核审核建议"));
    await expect.element(screen.getByText("已聚焦步骤活动")).toBeInTheDocument();
    expect(screen.container.textContent).toContain("复核通过");
    expect(screen.container.textContent).not.toContain("完成明确岗位审核标准");
    // Clearing returns to the full feed.
    await user.click(screen.getByText("查看全部活动"));
    await expect.element(screen.getByText("完成明确岗位审核标准")).toBeInTheDocument();
  });

  it("shows a hint when the selected step has no linked activities", async () => {
    await using setupResult = await setup(undefined, true);
    const { screen } = setupResult;
    const user = userEvent.setup();
    // t24's pending 复核审核建议 step has no activity yet.
    await user.click(screen.getByText("产品经理简历审核 #024").first());
    await expect.element(screen.getByText("待评审 · 2 / 4 步完成")).toBeInTheDocument();
    await user.click(screen.getByText("复核审核建议"));
    await expect.element(screen.getByText("该步骤暂无活动")).toBeInTheDocument();
    // The step graph stays visible alongside the hint.
    await expect.element(screen.getByText("初审简历")).toBeInTheDocument();
  });

  it("jumps from a selected step to its step conversation", async () => {
    await using setupResult = await setup();
    const { screen } = setupResult;
    const user = userEvent.setup();
    await user.click(screen.getByText("初审简历"));
    await user.click(screen.getByText("进入步骤会话"));
    const combobox = screen.getByRole("combobox");
    expect((combobox.element() as unknown as HTMLSelectElement).value).toBe(
      "t25::step-thread::step-review",
    );
  });

  it("preserves each task's selected step when switching tasks and back", async () => {
    await using setupResult = await setup(undefined, true);
    const { screen } = setupResult;
    const user = userEvent.setup();
    await user.click(screen.getByText("初审简历"));
    let node = screen.container.querySelector('[data-step-id="step-review"]');
    expect(node?.getAttribute("data-selected")).toBe("true");
    await user.click(screen.getByText("产品经理简历审核 #024").first());
    await expect.element(screen.getByText("待评审 · 2 / 4 步完成")).toBeInTheDocument();
    node = screen.container.querySelector('[data-step-id="step-review-24"]');
    expect(node?.getAttribute("data-selected")).toBe("false");
    await user.click(screen.getByText("产品经理简历审核 #025").first());
    await expect.element(screen.getByText("已完成 · 4 / 4 步完成")).toBeInTheDocument();
    node = screen.container.querySelector('[data-step-id="step-review"]');
    expect(node?.getAttribute("data-selected")).toBe("true");
  });
});
