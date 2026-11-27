import type {
  AgentInstanceView,
  MaskedAgentEnvVar,
} from "../../../../packages/workbench-core/src/agents/domain/AgentAvailability.ts";

export const AGENT_DIALOG_PALETTE = {
  pageBackground: "#0a0f1a",
  surface: "#101927",
  card: "#121d2e",
  field: "#0a0f1a",
  border: "#2a384b",
  text: "#f3f4f7",
  muted: "#9aa8bc",
  accent: "#1ad5ff",
  green: "#1cca5b",
  amber: "#e2b93b",
  red: "#e25b5b",
} as const;

/** Provider-specific launch defaults, shown when the field is empty. */
export const PROVIDER_LAUNCH_DEFAULTS: Record<
  AgentInstanceView["provider"],
  { executablePlaceholder: string; configDirEnv: string; argsPlaceholder: string }
> = {
  pi: { executablePlaceholder: "pi", configDirEnv: "PI_HOME", argsPlaceholder: "使用默认值" },
  codex: {
    executablePlaceholder: "codex",
    configDirEnv: "CODEX_HOME",
    argsPlaceholder: "使用默认值",
  },
  "claude-code": {
    executablePlaceholder: "claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    argsPlaceholder: "使用默认值",
  },
};

export const PROVIDER_ENV_EMPTY_HINTS: Record<AgentInstanceView["provider"], string> = {
  pi: "当前实例没有单独设置环境变量。",
  codex: "当前实例沿用设备上的 Codex 登录。",
  "claude-code": "凭据保存在运行设备。诊断信息与团队 YAML 不包含密钥。",
};

export const MODEL_STATUS_BY_FLAGS = {
  enabledVerified: "已启用",
  disabledVerified: "已停用",
  unverified: "未验证",
} as const;

export function modelStatus(model: { enabled: boolean; verified: boolean }): string {
  if (!model.verified) return MODEL_STATUS_BY_FLAGS.unverified;
  return model.enabled
    ? MODEL_STATUS_BY_FLAGS.enabledVerified
    : MODEL_STATUS_BY_FLAGS.disabledVerified;
}

export type { AgentInstanceView, MaskedAgentEnvVar };
