import type { ActivityItem, AgentTrailStatus } from "./domain";
import { cn } from "./cn";

/**
 * Right-hand AgentTrail activity feed. Linked activities jump to their step;
 * unlinked ones explain why they cannot. When AgentTrail is unavailable the
 * feed shows the reason and a retry, while the rest of the page stays usable.
 */
export function ActivityRail({
  feedTitle,
  activities,
  agentTrail,
  stepIds,
  focusedStepId,
  onJumpToStep,
  onClearStepFocus,
  onRetryAgentTrail,
}: {
  feedTitle: string;
  activities: readonly ActivityItem[];
  agentTrail: AgentTrailStatus;
  stepIds: ReadonlySet<string>;
  /** Step the graph currently focuses; the rail then lists only that step's activities. */
  focusedStepId: string | null;
  onJumpToStep: (stepId: string) => void;
  onClearStepFocus: () => void;
  onRetryAgentTrail: () => void;
}) {
  const focusedActivities =
    focusedStepId !== null
      ? activities.filter((activity) => activity.stepId === focusedStepId)
      : activities;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-[#2A384B] bg-[#0D1524]">
      <div className="flex items-center justify-between px-5 pt-5">
        <h3 className="text-sm font-medium text-[#F3F4F7]">
          {focusedStepId !== null ? "已聚焦步骤活动" : feedTitle}
        </h3>
        {focusedStepId !== null ? (
          <button
            type="button"
            onClick={onClearStepFocus}
            className="rounded-md border border-[#2A384B] px-3 py-1 text-xs text-[#F3F4F7] hover:bg-[#16233A]"
          >
            查看全部活动
          </button>
        ) : null}
      </div>
      {!agentTrail.available ? (
        <div className="mx-5 mt-3 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-amber-200">
          <p>{agentTrail.reason ?? "AgentTrail 暂不可用"}</p>
          <button
            type="button"
            onClick={onRetryAgentTrail}
            className="mt-2 rounded-md border border-[#2A384B] px-3 py-1 text-xs text-[#F3F4F7] hover:bg-[#16233A]"
          >
            重试 AgentTrail
          </button>
        </div>
      ) : null}
      <ol className="mt-2 flex-1 overflow-auto px-5 pb-5">
        {focusedActivities.length === 0 ? (
          <li className="pt-2 text-xs text-[#9AA8BC]">该步骤暂无活动</li>
        ) : null}
        {focusedActivities.map((activity) => {
          const linked = activity.stepId !== null && stepIds.has(activity.stepId);
          return (
            <li key={activity.id} className="relative flex gap-3 py-3 pl-1">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                  activity.kind === "conversation" ? "bg-cyan-300" : "bg-[#23272F]",
                )}
              />
              <div className="min-w-0 flex-1">
                {linked ? (
                  <button
                    type="button"
                    data-activity-id={activity.id}
                    data-step-id={activity.stepId}
                    onClick={() => onJumpToStep(activity.stepId as string)}
                    className="text-left text-sm font-medium text-[#F3F4F7] hover:text-cyan-300"
                  >
                    {activity.title}
                  </button>
                ) : (
                  <span
                    data-activity-id={activity.id}
                    className="cursor-default text-left text-sm font-medium text-[#F3F4F7]"
                  >
                    {activity.title}
                    <span className="ml-2 text-xs text-[#9AA8BC]">活动未关联步骤</span>
                  </span>
                )}
                <p className="mt-0.5 text-xs text-[#9AA8BC]">
                  {activity.time} · {activity.actor}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
