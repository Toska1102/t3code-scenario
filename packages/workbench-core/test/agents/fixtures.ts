import { AgentConnections } from "../../src/agents/application/AgentConnections.ts";
import type {
  AgentConnectionsOptions,
  AgentInstanceStore,
  AgentHealthProbe,
} from "../../src/agents/application/AgentInstanceStore.ts";
import type {
  AgentInstance,
  ConnectionCheckResult,
} from "../../src/agents/domain/AgentAvailability.ts";

const clock = { now: () => "2026-11-27T10:38:00.000Z" };

export function piInstance(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    instanceId: "pi-local",
    provider: "pi",
    displayName: "Pi",
    enabled: true,
    authState: "unauthenticated",
    isDefault: false,
    sourceLabel: "v1.6.0 · 本机 CLI",
    launch: {},
    envVars: [],
    models: [],
    ...overrides,
  };
}

export function availableInstance(
  instanceId: string,
  provider: AgentInstance["provider"],
  overrides: Partial<AgentInstance> = {},
): AgentInstance {
  return piInstance({
    instanceId,
    provider,
    displayName: provider === "codex" ? "Codex" : provider === "claude-code" ? "Claude Code" : "Pi",
    authState: "authenticated",
    ...overrides,
  });
}

export function boardCheck(
  message: string,
  status: ConnectionCheckResult["status"],
): ConnectionCheckResult {
  return { checkedAt: clock.now(), status, message, modelsDiscovered: [] };
}

export function boardInstances(): AgentInstance[] {
  return [
    piInstance(),
    availableInstance("codex-local", "codex", {
      isDefault: true,
      sourceLabel: "本机 CLI · 默认实例",
      lastCheck: boardCheck("app-server 已就绪，可以用于新任务。", "available"),
    }),
    availableInstance("claude-local", "claude-code", {
      sourceLabel: "v2.1.332 · 自定义端点",
      envVars: [
        { name: "ANTHROPIC_BASE_URL", value: "https://api.example.com", secret: false },
        { name: "ANTHROPIC_API_KEY", value: "sk-placeholder", secret: true },
      ],
      models: [
        {
          id: "claude-sonnet",
          label: "Claude Sonnet",
          source: "discovered",
          verified: true,
          enabled: true,
          favorite: true,
        },
        {
          id: "claude-opus",
          label: "Claude Opus",
          source: "discovered",
          verified: true,
          enabled: false,
          favorite: false,
        },
      ],
      lastCheck: boardCheck("自定义 API 端点已连接，可以用于新任务。", "available"),
    }),
  ];
}

export function inMemoryStore(instances = boardInstances()): AgentInstanceStore & {
  current(): AgentInstance[];
} {
  let state = instances;
  return {
    load: async () => state,
    save: async (next) => {
      state = next;
    },
    current: () => state,
  };
}

export function fakeProbe(result: Partial<ConnectionCheckResult> = {}): AgentHealthProbe & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    probe: async (input) => {
      calls.push(input);
      return { checkedAt: clock.now(), status: "available", message: "已就绪", ...result };
    },
  };
}

export function serviceWith(
  store: ReturnType<typeof inMemoryStore> | AgentInstanceStore = inMemoryStore(),
  probe: AgentConnectionsOptions["probe"] = undefined,
) {
  return new AgentConnections({ store, probe });
}
