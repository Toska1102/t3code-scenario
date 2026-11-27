import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ThreadIssueService } from "../orchestration-v2/ThreadIssueService.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { PeerLinks } from "../peer/PeerLinks.ts";
import { PeerMcpClient } from "../peer/PeerMcpClient.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { WorkflowAgents } from "./WorkflowAgents.ts";
import * as WorkflowAgentThreads from "./WorkflowAgentThreads.ts";
import { unavailable as forgeUnavailable, WorkflowForge } from "./WorkflowForge.ts";
import * as WorkflowProviderChecks from "./WorkflowProviderChecks.ts";

const instanceId = ProviderInstanceId.make("codex-local");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test-version",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-27T08:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const input = {
  key: "step-key",
  origin: { runId: "task-1", workflow: "workbench", step: "research" },
  title: "Research",
  prompt: "Summarize the input.",
  outputSchema: undefined,
  model: { instanceId, model: "test-model" },
  project: "project-1",
  environment: undefined,
  thread: undefined,
  limits: { tools: [], totalTokens: 4000 },
};

it.effect("blocks a constrained step before creating a provider turn", () =>
  Effect.gen(function* () {
    const turns: Array<string> = [];
    const agents = WorkflowAgents.of({
      start: (request) =>
        Effect.sync(() => {
          turns.push(request.key);
          return { threadId: "thread-1", turnId: "turn-1" };
        }),
      result: () => Effect.succeed({ ending: "completed", detail: "", reply: "done" }),
      interrupt: () => Effect.succeed("ended"),
    });
    const checks = yield* WorkflowProviderChecks.make;
    const blocked = yield* checks.guard(agents).start(input).pipe(Effect.flip);
    assert.deepStrictEqual(blocked.issues, [
      { step: "research", instanceId, reason: "tool_allowlist_unsupported" },
      { step: "research", instanceId, reason: "total_token_limit_unsupported" },
    ]);
    assert.include(blocked.message, "research");
    assert.include(blocked.message, "codex-local");
    assert.include(blocked.message, "tool_allowlist_unsupported");
    assert.include(blocked.message, "total_token_limit_unsupported");
    assert.deepStrictEqual(turns, []);
  }).pipe(
    Effect.provide(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) })),
  ),
);

it.effect("enforces hard limits at the production local, continuation and peer boundaries", () =>
  Effect.gen(function* () {
    const agents = yield* WorkflowAgents;
    for (const target of [
      input,
      { ...input, thread: "existing-thread" },
      { ...input, environment: "remote-environment" },
      { ...input, environment: "remote-environment", thread: "existing-thread" },
    ]) {
      const blocked = yield* agents.start(target).pipe(Effect.flip);
      assert.equal(blocked._tag, "WorkflowAgentError");
      assert.include(
        blocked.reason,
        target.environment === undefined
          ? "tool_allowlist_unsupported"
          : "remote_limits_unsupported",
      );
    }
  }).pipe(
    Effect.provide(
      WorkflowAgentThreads.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
            Layer.mock(ServerEnvironment)({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("local-environment")),
            }),
            Layer.mock(ThreadManagementService)({}),
            Layer.mock(ThreadLaunchService)({}),
            Layer.mock(ThreadIssueService)({}),
            Layer.mock(ProjectService)({}),
            Layer.mock(ServerSettingsService)({}),
            Layer.mock(PeerLinks)({}),
            Layer.mock(PeerMcpClient)({}),
            Layer.succeed(WorkflowForge, forgeUnavailable),
            NodeCrypto.layer,
          ),
        ),
      ),
    ),
  ),
);

it.effect("requires a pinned instance and refuses to check a remote step locally", () =>
  Effect.gen(function* () {
    const checks = yield* WorkflowProviderChecks.make;
    assert.deepStrictEqual(
      yield* checks.checkStep({ step: "research", instanceId: undefined, limits: input.limits }),
      [{ step: "research", instanceId: undefined, reason: "instance_required" }],
    );
    assert.deepStrictEqual(
      yield* checks.checkStep({
        step: "research",
        instanceId,
        environment: "another-environment",
        limits: input.limits,
      }),
      [{ step: "research", instanceId, reason: "remote_limits_unsupported" }],
    );
  }).pipe(
    Effect.provide(
      Layer.mock(ProviderRegistry)({
        getProviders: Effect.die("must not check the wrong instance"),
      }),
    ),
  ),
);

it.effect("rejects missing, output-only or invalid total-token budgets without probing", () =>
  Effect.gen(function* () {
    const checks = yield* WorkflowProviderChecks.make;
    const invalid = [
      { tools: [], totalTokens: 0 },
      { tools: [], totalTokens: -1 },
      { tools: [], totalTokens: 1.5 },
      { tools: [], totalTokens: Number.NaN },
      { tools: [], totalTokens: Number.POSITIVE_INFINITY },
      { tools: [], totalTokens: Number.MAX_SAFE_INTEGER + 1 },
      { tools: [], maxOutputTokens: 4000 },
      { tools: [" "], totalTokens: 4000 },
      { totalTokens: 4000 },
    ];
    for (const limits of invalid) {
      const issues = yield* checks.checkStep({ step: "research", instanceId, limits });
      assert.deepStrictEqual(issues, [{ step: "research", instanceId, reason: "invalid_limits" }]);
    }
  }).pipe(
    Effect.provide(
      Layer.mock(ProviderRegistry)({ getProviders: Effect.die("invalid limits must not probe") }),
    ),
  ),
);

it.effect("reports unavailable instances per step rather than a generic limit failure", () =>
  Effect.gen(function* () {
    const checks = yield* WorkflowProviderChecks.make;
    const issues = yield* checks.checkStep({
      step: "review",
      instanceId,
      limits: input.limits,
    });
    assert.deepStrictEqual(issues, [
      { step: "review", instanceId, reason: "instance_unavailable" },
    ]);
  }).pipe(
    Effect.provide(
      Layer.mock(ProviderRegistry)({
        getProviders: Effect.succeed([{ ...provider, enabled: false }]),
      }),
    ),
  ),
);

it.effect("blocks all three connected CLIs even when native session resume is available", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make<ReadonlyArray<ServerProvider>>([]);
    const checks = yield* WorkflowProviderChecks.make.pipe(
      Effect.provide(Layer.mock(ProviderRegistry)({ getProviders: Ref.get(current) })),
    );
    for (const name of ["pi", "codex", "claudeAgent"] as const) {
      const selected = ProviderInstanceId.make(`${name}-local`);
      yield* Ref.set(current, [
        {
          ...provider,
          instanceId: selected,
          driver: ProviderDriverKind.make(name),
          nativeSessions: { canList: true, canLoad: true, canResume: true },
          supportedRuntimeModes: ["full-access", "approval-required"],
        },
      ]);
      const issues = yield* checks.checkStep({
        step: "research",
        instanceId: selected,
        limits: { tools: ["read"], totalTokens: 1 },
      });
      assert.deepStrictEqual(issues, [
        { step: "research", instanceId: selected, reason: "tool_allowlist_unsupported" },
        { step: "research", instanceId: selected, reason: "total_token_limit_unsupported" },
      ]);
    }
  }),
);

it.effect("rechecks queued steps while letting an already-started turn finish", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make<ReadonlyArray<ServerProvider>>([provider]);
    const checks = yield* WorkflowProviderChecks.make.pipe(
      Effect.provide(Layer.mock(ProviderRegistry)({ getProviders: Ref.get(current) })),
    );
    const agents = checks.guard(
      WorkflowAgents.of({
        start: () => Effect.succeed({ threadId: "thread-1", turnId: "turn-1" }),
        result: () => Effect.succeed({ ending: "completed", detail: "", reply: "done" }),
        interrupt: () => Effect.die("disabling an instance must not interrupt an active turn"),
      }),
    );
    const turn = yield* agents.start({ ...input, limits: undefined });
    const requested = { step: "next", instanceId, limits: input.limits };
    assert.equal((yield* checks.checkStep(requested))[0]?.reason, "tool_allowlist_unsupported");
    for (const patch of [
      { enabled: false },
      { installed: false },
      { auth: { status: "unauthenticated" as const } },
      { auth: { status: "unknown" as const } },
      { status: "error" as const },
      { status: "disabled" as const },
      { availability: "unavailable" as const },
    ]) {
      yield* Ref.set(current, [{ ...provider, ...patch }]);
      assert.deepStrictEqual(yield* checks.checkStep(requested), [
        { step: "next", instanceId, reason: "instance_unavailable" },
      ]);
      const blocked = yield* agents.start(input).pipe(Effect.flip);
      assert.include(blocked.reason, "instance_unavailable");
    }
    yield* Ref.set(current, []);
    assert.deepStrictEqual(yield* checks.checkStep(requested), [
      { step: "next", instanceId, reason: "instance_unavailable" },
    ]);
    assert.equal((yield* agents.result(turn)).reply, "done");
    yield* Ref.set(current, [provider]);
    assert.equal((yield* checks.checkStep(requested))[0]?.reason, "tool_allowlist_unsupported");
  }),
);
