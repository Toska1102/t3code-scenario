import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ConversationScope } from "./domain";
import { conversationScopeKey, TASK_STATUS_LABEL } from "./domain";
import { createConversationStore } from "./conversations";
import { initialTaskRuntime, reduceTaskRuntime, type TaskRuntimeState } from "./runtime";
import type { TeamInfo, TaskDetailPorts, TaskSummary } from "./ports";
import { ActivityRail } from "./ActivityRail";
import { ConversationPanel } from "./ConversationPanel";
import { StepGraph } from "./StepGraph";
import { cn } from "./cn";

export interface TaskDetailPageProps {
  readonly projectName: string;
  readonly team: TeamInfo;
  readonly tasks: readonly TaskSummary[];
  readonly selectedTaskId: string;
  readonly onSelectTask: (taskId: string) => void;
  readonly ports: TaskDetailPorts;
  readonly agentAvailability?: string;
  readonly onBackToProject: () => void;
  readonly onOpenAgentConnections: () => void;
  /** Review area owned by the review flow; rendered between the graph and conversations. */
  readonly reviewSlot?: ReactNode;
  /** Results area owned by the delivery flow; rendered next to the review slot. */
  readonly resultsSlot?: ReactNode;
}

const shortTaskId = (title: string): string => /#\S+/.exec(title)?.[0] ?? "";

const TASK_BADGE_STYLE: Record<TaskSummary["status"], string> = {
  done: "border-emerald-400/60 text-emerald-300",
  "awaiting-review": "border-amber-400/60 text-amber-300",
  running: "border-cyan-300/60 text-cyan-300",
  failed: "border-red-400/60 text-red-300",
};

export function TaskDetailPage({
  projectName,
  team,
  tasks,
  selectedTaskId,
  onSelectTask,
  ports,
  agentAvailability,
  onBackToProject,
  onOpenAgentConnections,
  reviewSlot,
  resultsSlot,
}: TaskDetailPageProps) {
  const [runtimes, setRuntimes] = useState<ReadonlyMap<string, TaskRuntimeState>>(
    () => new Map([[selectedTaskId, initialTaskRuntime(selectedTaskId)]]),
  );
  const runtime = runtimes.get(selectedTaskId) ?? initialTaskRuntime(selectedTaskId);
  const snapshot = runtime.snapshot;

  // The store is a mutable cache outside React; storeVersion bumps force re-render.
  const store = useMemo(() => createConversationStore(), []);
  const [, setStoreVersion] = useState(0);
  const bumpStore = useCallback(() => setStoreVersion((v) => v + 1), []);

  // Selected step is kept per task, so switching tasks preserves each task's focus.
  const [stepFocusByTask, setStepFocusByTask] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );
  const selectedStepId = stepFocusByTask.get(selectedTaskId) ?? null;
  const [scopeByTask, setScopeByTask] = useState<ReadonlyMap<string, string>>(() => new Map());
  const loadedScopes = useRef(new Set<string>());
  const sendSeq = useRef(0);

  const updateRuntime = useCallback(
    (taskId: string, action: Parameters<typeof reduceTaskRuntime>[1]) => {
      setRuntimes((prev) => {
        const state = prev.get(taskId) ?? initialTaskRuntime(taskId);
        return new Map(prev).set(taskId, reduceTaskRuntime(state, action));
      });
    },
    [setRuntimes],
  );

  const fetchSnapshot = useCallback(
    async (taskId: string) => {
      updateRuntime(taskId, { type: "snapshot-loading" });
      try {
        const next = await ports.snapshot.fetchSnapshot(taskId);
        updateRuntime(taskId, { type: "snapshot-loaded", snapshot: next });
      } catch (error) {
        updateRuntime(taskId, {
          type: "transport-failed",
          message: error instanceof Error ? error.message : "加载失败",
        });
      }
    },
    [ports, updateRuntime],
  );

  // Subscribe to this task's event stream; the first visit also loads its
  // snapshot: the server owns task state, so the page synchronizes with that
  // external system here. Later visits reuse the cached runtime instantly.
  const fetchedTasks = useRef(new Set<string>());
  useEffect(() => {
    const subscription = ports.events.subscribe(selectedTaskId, {
      onEvent: (event) => {
        if (event.type === "conversation-message") {
          store.append(event.scope, event.message);
          bumpStore();
          return;
        }
        updateRuntime(selectedTaskId, event);
      },
      onGap: () => {
        // A missed stretch of the stream is recovered by refetching the snapshot.
        updateRuntime(selectedTaskId, { type: "stream-gap" });
        void fetchSnapshot(selectedTaskId);
      },
      onTransportError: (message) => {
        updateRuntime(selectedTaskId, { type: "transport-failed", message });
      },
    });
    if (!fetchedTasks.current.has(selectedTaskId)) {
      fetchedTasks.current.add(selectedTaskId);
      void fetchSnapshot(selectedTaskId);
    }
    return () => subscription.close();
  }, [selectedTaskId, ports, store, bumpStore, updateRuntime, fetchSnapshot]);

  // Load conversation history the first time a scope becomes active; live
  // messages arrive through events and are stored under their exact scope.
  const activeScopeKey = snapshot
    ? (scopeByTask.get(selectedTaskId) ??
      (snapshot.conversations[0] ? conversationScopeKey(snapshot.conversations[0].scope) : ""))
    : "";
  const activeScope = useMemo(() => {
    if (!snapshot || !activeScopeKey) return null;
    return (
      snapshot.conversations.find((c) => conversationScopeKey(c.scope) === activeScopeKey)?.scope ??
      snapshot.conversations[0]?.scope ??
      null
    );
  }, [snapshot, activeScopeKey]);

  useEffect(() => {
    if (!activeScope || loadedScopes.current.has(conversationScopeKey(activeScope))) return;
    loadedScopes.current.add(conversationScopeKey(activeScope));
    void ports.conversations.listMessages(activeScope).then((messages) => {
      store.replaceMessages(activeScope, messages);
      bumpStore();
    });
  }, [activeScope, ports, store, bumpStore]);

  const handleSend = useCallback(
    (scope: ConversationScope, text: string) => {
      if (!store.canSend(scope, text)) return;
      sendSeq.current += 1;
      const messageId = `local-${sendSeq.current}`;
      store.setSending(scope, true);
      store.append(scope, { id: messageId, role: "user", text, status: "pending" });
      // The text now lives in the pending message; the composer starts fresh.
      store.setDraft(scope, "");
      bumpStore();
      void ports.conversations
        .sendMessage(scope, text)
        .then(() => {
          store.markSent(scope, messageId);
        })
        .catch(() => {
          store.markFailed(scope, messageId);
        })
        .finally(() => {
          store.setSending(scope, false);
          bumpStore();
        });
    },
    [ports, store, bumpStore],
  );

  const handleRetrySend = useCallback(
    (scope: ConversationScope, messageId: string, text: string) => {
      store.setStatus(scope, messageId, "pending");
      bumpStore();
      void ports.conversations
        .sendMessage(scope, text)
        .then(() => {
          store.markSent(scope, messageId);
        })
        .catch(() => {
          store.markFailed(scope, messageId);
        })
        .finally(() => {
          store.setSending(scope, false);
          bumpStore();
        });
    },
    [ports, store, bumpStore],
  );

  const focusStep = useCallback(
    (taskId: string, stepId: string | null) => {
      setStepFocusByTask((prev) => new Map(prev).set(taskId, stepId));
    },
    [setStepFocusByTask],
  );

  const selectTask = useCallback(
    (taskId: string) => {
      onSelectTask(taskId);
    },
    [onSelectTask],
  );

  const stepIds = useMemo(
    () => new Set(snapshot?.graph.steps.map((step) => step.id) ?? []),
    [snapshot],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0A0F1A] text-[#F3F4F7]">
      <header className="flex items-center justify-between border-b border-[#2A384B] bg-[#101927] px-6 py-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-300/40 font-semibold text-cyan-300">
            A
          </span>
          <span className="font-semibold">{projectName}</span>
          <span className="text-[#9AA8BC]">/</span>
          <span className="text-[#9AA8BC]">具体任务</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToProject}
            className="rounded-lg border border-[#2A384B] bg-[#0A0F1A] px-4 py-2.5 text-sm hover:bg-[#16233A]"
          >
            返回项目详情
          </button>
          <button
            type="button"
            onClick={onOpenAgentConnections}
            className="rounded-lg border border-[#2A384B] bg-[#0A0F1A] px-4 py-2.5 text-sm hover:bg-[#16233A]"
          >
            Agent 连接
            {agentAvailability ? (
              <span className="ml-2 text-[#9AA8BC]">{agentAvailability}</span>
            ) : null}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-[#2A384B] bg-[#101A29]">
          <section className="border-b border-[#2A384B] p-5">
            <h2 className="text-sm font-semibold">团队管理</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex gap-6">
                <dt className="text-[#9AA8BC]">团队名称</dt>
                <dd>{team.name}</dd>
              </div>
              <div className="flex gap-6">
                <dt className="shrink-0 text-[#9AA8BC]">团队描述</dt>
                <dd className="min-w-0">{team.description}</dd>
              </div>
              <div className="flex gap-6">
                <dt className="text-[#9AA8BC]">建立时间</dt>
                <dd>{team.establishedAt}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[#9AA8BC]">{team.nodeCount} 个节点</dt>
                <dd>
                  <button
                    type="button"
                    className="rounded-lg border border-[#2A384B] px-3 py-1.5 text-xs hover:bg-[#16233A]"
                  >
                    组织架构
                  </button>
                </dd>
              </div>
            </dl>
          </section>
          <section className="flex min-h-0 flex-1 flex-col p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">项目任务</h2>
              <button type="button" className="text-xs text-cyan-300">
                + 描述要做的事
              </button>
            </div>
            <ul className="mt-3 space-y-2 overflow-auto">
              {tasks.map((task) => {
                const selected = task.taskId === selectedTaskId;
                return (
                  <li key={task.taskId}>
                    <button
                      type="button"
                      data-task-id={task.taskId}
                      onClick={() => selectTask(task.taskId)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left",
                        selected
                          ? "border-cyan-300/70 bg-[#12233A]"
                          : "border-[#2A384B] bg-[#0D1524] hover:bg-[#122036]",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{task.title}</span>
                        <span className="mt-0.5 block text-xs text-[#9AA8BC]">
                          {shortTaskId(task.title)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2.5 py-1 text-xs",
                          TASK_BADGE_STYLE[task.status],
                        )}
                      >
                        {TASK_STATUS_LABEL[task.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
        <main className="flex min-h-0 flex-1 flex-col px-6">
          <div className="flex items-center justify-between border-b border-[#2A384B] py-4">
            <h2 className="border-b-2 border-cyan-300 pb-4 text-sm font-medium text-cyan-300">
              运行进度 · AgentTrail
            </h2>
            <div className="flex items-center gap-3">
              {snapshot ? (
                <span className="rounded-full border border-[#2A384B] px-3 py-1.5 text-xs text-[#9AA8BC]">
                  执行流程 · {snapshot.workflowVersion}
                </span>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-[#2A384B] px-4 py-2 text-sm hover:bg-[#16233A]"
              >
                查看流程
              </button>
              <button
                type="button"
                className="rounded-lg border border-[#2A384B] px-4 py-2 text-sm hover:bg-[#16233A]"
              >
                用此流程再派一单
              </button>
            </div>
          </div>
          {runtime.phase === "failed" ? (
            <div className="mt-6 rounded-lg border border-red-400/60 bg-red-400/10 p-4 text-sm">
              <p>暂时无法加载任务：{runtime.transportError}</p>
              <button
                type="button"
                onClick={() => void fetchSnapshot(selectedTaskId)}
                className="mt-2 rounded-md border border-[#2A384B] px-3 py-1 text-xs hover:bg-[#16233A]"
              >
                重试
              </button>
            </div>
          ) : null}
          {snapshot ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between py-4">
                <h1 className="text-lg font-semibold">{snapshot.title}</h1>
                <span className="rounded-full border border-emerald-400/60 px-3 py-1 text-xs text-emerald-300">
                  {TASK_STATUS_LABEL[snapshot.status]} · {snapshot.completedSteps} /{" "}
                  {snapshot.totalSteps} 步完成
                </span>
              </div>
              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="pb-2 text-xs text-[#9AA8BC]">本次任务步骤</p>
                  <StepGraph
                    graph={snapshot.graph}
                    selectedStepId={selectedStepId}
                    onSelectStep={(stepId) => focusStep(selectedTaskId, stepId)}
                  />
                  {selectedStepId ? (
                    <div className="flex items-center gap-3 pt-3">
                      <span className="text-xs text-[#9AA8BC]">已选中步骤</span>
                      <button
                        type="button"
                        data-testid="enter-step-conversation"
                        onClick={() => {
                          const descriptor = snapshot.conversations.find(
                            (c) =>
                              c.scope.kind === "step-thread" && c.scope.stepId === selectedStepId,
                          );
                          if (descriptor) {
                            setScopeByTask((prev) =>
                              new Map(prev).set(
                                selectedTaskId,
                                conversationScopeKey(descriptor.scope),
                              ),
                            );
                            bumpStore();
                          }
                        }}
                        className="rounded-lg border border-[#2A384B] px-3 py-1 text-xs hover:bg-[#16233A]"
                      >
                        进入步骤会话
                      </button>
                      <button
                        type="button"
                        onClick={() => focusStep(selectedTaskId, null)}
                        className="rounded-lg border border-[#2A384B] px-3 py-1 text-xs hover:bg-[#16233A]"
                      >
                        取消聚焦
                      </button>
                    </div>
                  ) : null}
                  {reviewSlot || resultsSlot ? (
                    <div className="grid gap-3 py-3 md:grid-cols-2">
                      {reviewSlot ? <section>{reviewSlot}</section> : null}
                      {resultsSlot ? <section>{resultsSlot}</section> : null}
                    </div>
                  ) : null}
                  <ConversationPanel
                    conversations={snapshot.conversations}
                    activeScopeKey={activeScopeKey}
                    onScopeChange={(scope) => {
                      setScopeByTask((prev) =>
                        new Map(prev).set(scope.taskId, conversationScopeKey(scope)),
                      );
                      bumpStore();
                    }}
                    store={store}
                    composerPlaceholder={`询问或补充 ${shortTaskId(snapshot.title)} 的任务材料...`}
                    onDraftChange={bumpStore}
                    onSend={handleSend}
                    onRetry={handleRetrySend}
                  />
                </div>
                <ActivityRail
                  feedTitle={`${shortTaskId(snapshot.title)} 运行活动`}
                  activities={snapshot.activities}
                  agentTrail={snapshot.agentTrail}
                  stepIds={stepIds}
                  focusedStepId={selectedStepId}
                  onJumpToStep={(stepId) => focusStep(selectedTaskId, stepId)}
                  onClearStepFocus={() => focusStep(selectedTaskId, null)}
                  onRetryAgentTrail={() => void fetchSnapshot(selectedTaskId)}
                />
              </div>
            </div>
          ) : runtime.phase === "loading" || runtime.phase === "idle" ? (
            <p className="py-10 text-sm text-[#9AA8BC]">正在加载任务…</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
