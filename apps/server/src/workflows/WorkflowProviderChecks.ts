import { WorkflowAgentLimits } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import {
  WorkflowAgentError,
  WorkflowAgents,
  type WorkflowProviderIssue,
} from "./WorkflowAgents.ts";

interface StepRequirements {
  readonly step: string;
  readonly instanceId: string | undefined;
  readonly limits: unknown;
  readonly environment?: string | undefined;
}

const isLimits = Schema.is(WorkflowAgentLimits);

const recovery = {
  invalid_limits: "Provide a tool allowlist and a positive safe-integer totalTokens budget",
  instance_required: "Pin the step to a specific model and provider instance",
  remote_limits_unsupported: "The peer launch protocol cannot carry these hard limits",
  instance_unavailable: "Enable and authenticate the selected instance before retrying this step",
  tool_allowlist_unsupported: "The T3 turn interface cannot enforce a per-step tool allowlist",
  total_token_limit_unsupported:
    "The T3 turn interface cannot enforce a total input-and-output token budget",
} satisfies Record<WorkflowProviderIssue["reason"], string>;

export const make = Effect.gen(function* () {
  const providers = yield* ProviderRegistry;
  const checkStep = Effect.fn("WorkflowProviderChecks.checkStep")(function* (
    input: StepRequirements,
  ): Effect.fn.Return<ReadonlyArray<WorkflowProviderIssue>> {
    if (!isLimits(input.limits)) {
      return [{ step: input.step, instanceId: input.instanceId, reason: "invalid_limits" }];
    }
    if (input.instanceId === undefined || input.instanceId.trim().length === 0) {
      return [{ step: input.step, instanceId: input.instanceId, reason: "instance_required" }];
    }
    if (input.environment !== undefined) {
      return [
        { step: input.step, instanceId: input.instanceId, reason: "remote_limits_unsupported" },
      ];
    }
    const instance = (yield* providers.getProviders).find(
      (candidate) => candidate.instanceId === input.instanceId,
    );
    if (
      instance === undefined ||
      !instance.enabled ||
      !instance.installed ||
      instance.auth.status !== "authenticated" ||
      instance.status === "error" ||
      instance.status === "disabled" ||
      instance.availability === "unavailable"
    ) {
      return [{ step: input.step, instanceId: input.instanceId, reason: "instance_unavailable" }];
    }
    return [
      { step: input.step, instanceId: input.instanceId, reason: "tool_allowlist_unsupported" },
      { step: input.step, instanceId: input.instanceId, reason: "total_token_limit_unsupported" },
    ];
  });

  const guard = (agents: WorkflowAgents["Service"]) =>
    WorkflowAgents.of({
      ...agents,
      start: Effect.fn("WorkflowProviderChecks.start")(function* (input) {
        if (input.limits !== undefined) {
          const issues = yield* checkStep({
            step: input.origin.step,
            instanceId: input.model?.instanceId,
            limits: input.limits,
            environment: input.environment,
          });
          if (issues.length > 0) {
            return yield* new WorkflowAgentError({
              issues,
              reason: issues
                .map(
                  (issue) =>
                    `Step ${issue.step}, instance ${issue.instanceId ?? "unselected"}: ${issue.reason}. ${recovery[issue.reason]}.`,
                )
                .join("; "),
            });
          }
        }
        return yield* agents.start(input);
      }),
    });

  return { checkStep, guard };
});
