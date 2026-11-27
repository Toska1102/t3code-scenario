export type AgentProviderId = "pi" | "codex" | "claude-code";

export type AgentAuthState = "authenticated" | "unauthenticated" | "unknown";

export interface AgentInstanceModel {
  id: string;
  label: string;
  source: "discovered" | "custom";
  verified: boolean;
  enabled: boolean;
  favorite: boolean;
}

export interface AgentEnvVar {
  name: string;
  value: string;
  secret: boolean;
}

export interface AgentLaunchConfig {
  executable?: string;
  args?: string;
  configDir?: string;
  /** Claude Code context compression threshold; empty inherits the environment. */
  compressionThreshold?: string;
  /** Claude Code idle compression policy; empty inherits the environment. */
  idleCompression?: string;
}

export interface ConnectionCheckResult {
  checkedAt: string;
  status: "available" | "unauthenticated" | "not_found" | "timeout";
  message: string;
  modelsDiscovered?: string[];
}

export interface AgentInstance {
  instanceId: string;
  provider: AgentProviderId;
  displayName: string;
  enabled: boolean;
  authState: AgentAuthState;
  isDefault: boolean;
  sourceLabel: string;
  launch: AgentLaunchConfig;
  envVars: AgentEnvVar[];
  models: AgentInstanceModel[];
  lastCheck?: ConnectionCheckResult;
}

/** A client-visible instance: availability derived, secrets masked. */
export interface AgentInstanceView {
  instanceId: string;
  provider: AgentProviderId;
  displayName: string;
  enabled: boolean;
  authState: AgentAuthState;
  available: boolean;
  isDefault: boolean;
  statusBadge: string;
  sourceLabel: string;
  launch: AgentLaunchConfig;
  envVars: MaskedAgentEnvVar[];
  models: AgentInstanceModel[];
  lastCheck?: ConnectionCheckResult;
}

export interface MaskedAgentEnvVar extends Omit<AgentEnvVar, "value"> {
  value: string;
}

export interface AgentDeviceSummary {
  totalCount: number;
  availableCount: number;
  defaultInstanceId?: string;
  instances: AgentInstanceView[];
}

export const SECRET_MASK = "••••••••";

const AUTH_BADGES: Record<AgentAuthState, string> = {
  authenticated: "可用",
  unauthenticated: "需要认证",
  unknown: "未检测",
};

/**
 * R07: availability is enablement AND authentication. The dialog shows 启用,
 * authentication and 可用 as three separate facts.
 */
export function isInstanceAvailable(instance: AgentInstance): boolean {
  return instance.enabled && instance.authState === "authenticated";
}

export function instanceStatusBadge(instance: AgentInstance): string {
  if (!instance.enabled) return "已停用";
  return AUTH_BADGES[instance.authState];
}

/**
 * R08: a model earns dispatch eligibility only through verification plus
 * enablement; enabling an unverified model never grants it.
 */
export function isModelDispatchable(model: AgentInstanceModel): boolean {
  return model.verified && model.enabled;
}

/**
 * R13: at most one default instance per device; the default may itself be
 * unavailable (availability count and default choice are independent).
 */
export function summarizeInstances(instances: AgentInstance[]): AgentDeviceSummary {
  const defaultInstance = instances.find((instance) => instance.isDefault);
  return {
    totalCount: instances.length,
    availableCount: instances.filter(isInstanceAvailable).length,
    ...(defaultInstance ? { defaultInstanceId: defaultInstance.instanceId } : {}),
    instances: instances.map(redactInstance),
  };
}

export function redactInstance(instance: AgentInstance): AgentInstanceView {
  return {
    instanceId: instance.instanceId,
    provider: instance.provider,
    displayName: instance.displayName,
    enabled: instance.enabled,
    authState: instance.authState,
    available: isInstanceAvailable(instance),
    isDefault: instance.isDefault,
    statusBadge: instanceStatusBadge(instance),
    sourceLabel: instance.sourceLabel,
    launch: instance.launch,
    envVars: instance.envVars.map((envVar) => ({
      ...envVar,
      value: envVar.secret ? SECRET_MASK : envVar.value,
    })),
    models: instance.models,
    ...(instance.lastCheck ? { lastCheck: instance.lastCheck } : {}),
  };
}
