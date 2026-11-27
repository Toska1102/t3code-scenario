import { useEffect, useState, type CSSProperties } from "react";
import type { AgentConnections } from "../../../../packages/workbench-core/src/agents/application/AgentConnections.ts";
import {
  SECRET_MASK,
  type AgentEnvVar,
  type AgentInstanceView,
} from "../../../../packages/workbench-core/src/agents/domain/AgentAvailability.ts";
import {
  AGENT_DIALOG_PALETTE as P,
  PROVIDER_ENV_EMPTY_HINTS,
  PROVIDER_LAUNCH_DEFAULTS,
  modelStatus,
} from "./agentDialogConfig.ts";
import {
  createAgentConnectionsViewModel,
  type AgentConnectionsViewModel,
} from "./AgentConnectionsViewModel.ts";

export interface AgentConnectionsDialogProps {
  service: AgentConnections;
  open: boolean;
  onClose: () => void;
}

/**
 * Agent 连接 dialog (boards 05.01–05.03): instance list on the left, the
 * selected instance's launch config, environment variables and models on the
 * right. One dialog, three selection states.
 */
export function AgentConnectionsDialog({ service, open, onClose }: AgentConnectionsDialogProps) {
  const [vm] = useState(() => createAgentConnectionsViewModel({ service }));
  const [, render] = useState(0);
  const [checking, setChecking] = useState(false);
  const [modelInput, setModelInput] = useState("");
  const [modelError, setModelError] = useState("");
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>({});

  const rerender = () => render((n) => n + 1);
  const { open: loadSnapshot } = vm;

  useEffect(() => {
    if (open) void loadSnapshot().then(rerender);
  }, [open, loadSnapshot, rerender]);

  if (!open || vm.summary.totalCount === 0) return null;

  const selected = vm.summary.instances.find(
    (instance) => instance.instanceId === vm.selectedInstanceId,
  );
  if (!selected) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agent 连接"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4, 8, 14, 0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: 880,
          maxWidth: "94vw",
          height: 640,
          maxHeight: "92vh",
          background: P.surface,
          border: `1px solid ${P.border}`,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: P.text,
        }}
      >
        <DialogTitle onClose={() => close(vm, onClose)} />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <AgentSummaryList
            summary={vm.summary}
            selectedId={vm.selectedInstanceId}
            onSelect={(id) => {
              vm.selectInstance(id);
              rerender();
            }}
          />
          {selected && (
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <AgentDetailHeader
                instance={selected}
                lastCheck={vm.lastCheckFor(selected.instanceId) ?? selected.lastCheck}
                checking={checking}
                onToggleEnabled={async () => {
                  await vm.setEnabled(selected.instanceId, !selected.enabled);
                  rerender();
                }}
                onSetDefault={async () => {
                  await vm.setDefault(selected.instanceId);
                  rerender();
                }}
                onCheck={async () => {
                  setChecking(true);
                  try {
                    await vm.checkSelected();
                    rerender();
                  } finally {
                    setChecking(false);
                  }
                }}
              />
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "16px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <LaunchConfigCard vm={vm} instance={selected} rerender={rerender} />
                <EnvVarsCard
                  vm={vm}
                  instance={selected}
                  rerender={rerender}
                  secretVisible={secretVisible}
                  setSecretVisible={setSecretVisible}
                />
                <ModelsCard
                  instance={selected}
                  modelInput={modelInput}
                  setModelInput={setModelInput}
                  modelError={modelError}
                  onAddModel={async () => {
                    try {
                      await service.addCustomModel(selected.instanceId, modelInput);
                      setModelError("");
                      setModelInput("");
                    } catch (error) {
                      setModelError(modelErrorMessage(error));
                    }
                    rerender();
                  }}
                  onToggleModel={async (modelId, enabled) => {
                    await service.setModelEnabled(selected.instanceId, modelId, enabled);
                    rerender();
                  }}
                  onToggleFavorite={async (modelId, favorite) => {
                    await service.setModelFavorite(selected.instanceId, modelId, favorite);
                    rerender();
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter
          hasUnsavedChanges={vm.hasUnsavedChanges}
          onDiscard={() => {
            vm.discardSelected();
            rerender();
          }}
          onSave={async () => {
            await vm.saveSelected();
            rerender();
          }}
        />
      </div>
    </div>
  );
}

function close(vm: AgentConnectionsViewModel, onClose: () => void) {
  if (vm.hasUnsavedChanges && !window.confirm("有未保存的修改。确定放弃修改并关闭？")) return;
  onClose();
}

function modelErrorMessage(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "duplicate_model_id") return "该模型 ID 已存在。";
  if (code === "invalid_model_id") return "模型 ID 不能为空或包含空白。";
  return "添加失败，请重试。";
}

function DialogTitle({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderBottom: `1px solid ${P.border}`,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Agent 连接</h2>
      <button aria-label="关闭" onClick={onClose} style={ghostButtonStyle}>
        ✕
      </button>
    </div>
  );
}

function AgentSummaryList({
  summary,
  selectedId,
  onSelect,
}: {
  summary: AgentConnectionsViewModel["summary"];
  selectedId: string;
  onSelect: (instanceId: string) => void;
}) {
  return (
    <nav
      aria-label="本机 Agent"
      style={{
        width: 248,
        borderRight: `1px solid ${P.border}`,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>本机 Agent</span>
        <span style={{ fontSize: 12, color: P.muted }}>
          {summary.availableCount} / {summary.totalCount} 可用
        </span>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {summary.instances.map((instance) => (
          <li key={instance.instanceId}>
            <button
              onClick={() => onSelect(instance.instanceId)}
              aria-current={instance.instanceId === selectedId || undefined}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${instance.instanceId === selectedId ? P.accent : P.border}`,
                background:
                  instance.instanceId === selectedId ? "rgba(26, 221, 255, 0.08)" : P.field,
                color: P.text,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {instance.displayName}
                <StatusBadge instance={instance} />
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: P.muted,
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {instance.isDefault && <span style={{ color: P.accent }}>默认</span>}
                {instance.sourceLabel}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: "auto", fontSize: 12, color: P.muted }}>
        可在团队的组织架构中为岗位绑定 Agent。
      </p>
    </nav>
  );
}

function StatusBadge({ instance }: { instance: AgentInstanceView }) {
  const color =
    instance.statusBadge === "可用"
      ? P.green
      : instance.statusBadge === "需要认证"
        ? P.amber
        : P.muted;
  return (
    <span
      data-status={instance.statusBadge}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        color,
        background: `${color}1a`,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        padding: "2px 8px",
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {instance.statusBadge}
    </span>
  );
}

function AgentDetailHeader({
  instance,
  lastCheck,
  checking,
  onToggleEnabled,
  onSetDefault,
  onCheck,
}: {
  instance: AgentInstanceView;
  lastCheck?: { checkedAt: string; message: string };
  checking: boolean;
  onToggleEnabled: () => Promise<void>;
  onSetDefault: () => Promise<void>;
  onCheck: () => Promise<void>;
}) {
  const checkedAt = lastCheck ? `上次检查 ${formatTime(lastCheck.checkedAt)}` : "尚未检测";
  return (
    <div
      style={{
        padding: "14px 20px",
        borderBottom: `1px solid ${P.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{instance.displayName}</h3>
        <StatusBadge instance={instance} />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Switch checked={instance.enabled} label="启用" onChange={onToggleEnabled} />
          <button
            onClick={onSetDefault}
            disabled={!instance.available}
            style={instance.isDefault ? primaryButtonStyle : ghostButtonStyle}
          >
            {instance.isDefault ? "当前默认" : "设为默认"}
          </button>
          <button onClick={onCheck} disabled={checking} style={ghostButtonStyle}>
            {checking ? "检测中…" : "⟳ 检查连接"}
          </button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: P.muted }}>
        {checkedAt}
        {lastCheck ? ` · ${lastCheck.message}` : ""}
      </p>
    </div>
  );
}

function LaunchConfigCard({
  vm,
  instance,
  rerender,
}: {
  vm: AgentConnectionsViewModel;
  instance: AgentInstanceView;
  rerender: () => void;
}) {
  const defaults = PROVIDER_LAUNCH_DEFAULTS[instance.provider];
  const launch = vm.draftFor(instance.instanceId).launch;
  const field = (
    label: string,
    key: keyof typeof launch,
    placeholder: string,
    envSuffix?: string,
  ) => (
    <label
      style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: P.muted }}
    >
      {label}
      {envSuffix ? ` · ${envSuffix}` : ""}
      <input
        value={launch[key] ?? ""}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => {
          vm.editLaunch(instance.instanceId, { [key]: event.target.value });
          rerender();
        }}
        style={inputStyle}
      />
    </label>
  );
  return (
    <section aria-label="启动配置" style={cardStyle}>
      <h4 style={cardTitleStyle}>启动配置</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {field("可执行文件", "executable", defaults.executablePlaceholder)}
        {field("启动参数", "args", defaults.argsPlaceholder)}
        {field(
          "配置目录",
          "configDir",
          `~/${defaults.executablePlaceholder}`,
          defaults.configDirEnv,
        )}
        {instance.provider === "claude-code" &&
          field("压缩阈值", "compressionThreshold", "使用默认值")}
        {instance.provider === "claude-code" &&
          field("空闲压缩", "idleCompression", "继承环境设置")}
      </div>
      {instance.provider === "pi" && <p style={hintStyle}>Pi AgentTrail 扩展 · 尚未检测</p>}
    </section>
  );
}

function EnvVarsCard({
  vm,
  instance,
  rerender,
  secretVisible,
  setSecretVisible,
}: {
  vm: AgentConnectionsViewModel;
  instance: AgentInstanceView;
  rerender: () => void;
  secretVisible: Record<string, boolean>;
  setSecretVisible: (next: Record<string, boolean>) => void;
}) {
  const envVars = vm.draftFor(instance.instanceId).envVars;
  const setEnvVars = (next: AgentEnvVar[]) => {
    vm.editEnvVars(instance.instanceId, next);
    rerender();
  };
  return (
    <section aria-label="环境变量" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={cardTitleStyle}>环境变量</h4>
        <button
          onClick={() => setEnvVars([...envVars, { name: "", value: "", secret: false }])}
          style={ghostButtonStyle}
        >
          ＋ 添加
        </button>
      </div>
      {envVars.length === 0 ? (
        <p style={hintStyle}>{PROVIDER_ENV_EMPTY_HINTS[instance.provider]}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {envVars.map((envVar, index) => {
            const key = `${index}-${envVar.name}`;
            const shown = envVar.secret && !secretVisible[key] ? SECRET_MASK : envVar.value;
            return (
              <li key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  aria-label="变量名"
                  value={envVar.name}
                  onChange={(event) => {
                    const next = [...envVars];
                    next[index] = { ...envVar, name: event.target.value };
                    setEnvVars(next);
                  }}
                  style={{ ...inputStyle, width: 180 }}
                />
                <input
                  aria-label="变量值"
                  value={shown}
                  type={envVar.secret && !secretVisible[key] ? "password" : "text"}
                  onChange={(event) => {
                    const next = [...envVars];
                    next[index] = { ...envVar, value: event.target.value };
                    setEnvVars(next);
                  }}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <Switch
                  checked={envVar.secret}
                  label="密钥"
                  onChange={(next) => {
                    const copy = [...envVars];
                    copy[index] = { ...envVar, secret: next };
                    setEnvVars(copy);
                  }}
                />
                <button
                  aria-label="显示或隐藏值"
                  onClick={() => setSecretVisible({ ...secretVisible, [key]: !secretVisible[key] })}
                  style={ghostButtonStyle}
                >
                  {secretVisible[key] ? "🙈" : "👁"}
                </button>
                <button
                  aria-label="删除变量"
                  onClick={() => setEnvVars(envVars.filter((_, i) => i !== index))}
                  style={ghostButtonStyle}
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p style={hintStyle}>{PROVIDER_ENV_EMPTY_HINTS[instance.provider]}</p>
    </section>
  );
}

function ModelsCard({
  instance,
  modelInput,
  setModelInput,
  modelError,
  onAddModel,
  onToggleModel,
  onToggleFavorite,
}: {
  instance: AgentInstanceView;
  modelInput: string;
  setModelInput: (value: string) => void;
  modelError: string;
  onAddModel: () => Promise<void>;
  onToggleModel: (modelId: string, enabled: boolean) => Promise<void>;
  onToggleFavorite: (modelId: string, favorite: boolean) => Promise<void>;
}) {
  return (
    <section aria-label="模型" style={cardStyle}>
      <h4 style={cardTitleStyle}>模型</h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "24px 1fr 120px 100px 60px",
          gap: 8,
          fontSize: 12,
          color: P.muted,
          padding: "4px 8px",
        }}
      >
        <span aria-hidden /> <span>模型</span> <span>来源</span> <span>状态</span> <span>启用</span>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {instance.models.map((model) => (
          <li
            key={model.id}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr 120px 100px 60px",
              gap: 8,
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: 8,
              background: P.field,
            }}
          >
            <button
              aria-label={model.favorite ? "取消收藏" : "收藏"}
              onClick={() => onToggleFavorite(model.id, !model.favorite)}
              style={{ ...ghostButtonStyle, color: model.favorite ? P.amber : P.muted }}
            >
              {model.favorite ? "★" : "☆"}
            </button>
            <span style={{ fontSize: 13 }}>{model.label}</span>
            <span style={{ fontSize: 12, color: P.muted }}>
              {model.source === "discovered" ? "自动发现" : "自定义"}
            </span>
            <span style={{ fontSize: 12, color: modelStatusColor(model) }}>
              {modelStatus(model)}
            </span>
            <Switch
              checked={model.enabled}
              label={`启用 ${model.label}`}
              onChange={(enabled) => onToggleModel(model.id, enabled)}
            />
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          aria-label="添加自定义模型 ID"
          placeholder="添加自定义模型 ID"
          value={modelInput}
          onChange={(event) => setModelInput(event.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={onAddModel} style={ghostButtonStyle}>
          添加模型
        </button>
      </div>
      {modelError && (
        <p style={{ ...hintStyle, color: P.red }} role="alert">
          {modelError}
        </p>
      )}
    </section>
  );
}

function modelStatusColor(model: { enabled: boolean; verified: boolean }): string {
  if (!model.verified) return P.amber;
  return model.enabled ? P.green : P.muted;
}

function DialogFooter({
  hasUnsavedChanges,
  onDiscard,
  onSave,
}: {
  hasUnsavedChanges: boolean;
  onDiscard: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderTop: `1px solid ${P.border}`,
      }}
    >
      <span style={{ fontSize: 12, color: P.muted }}>
        {hasUnsavedChanges ? "有未保存的修改" : "所有修改已保存"}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDiscard} style={ghostButtonStyle}>
          放弃修改
        </button>
        <button onClick={onSave} style={primaryButtonStyle}>
          保存
        </button>
      </div>
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void | Promise<void>;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        border: "none",
        background: checked ? P.accent : `${P.muted}44`,
        position: "relative",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? P.surface : P.text,
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}

function formatTime(iso: string): string {
  const time = iso.slice(11, 16);
  return time || iso;
}

const cardStyle: CSSProperties = {
  background: P.card,
  border: `1px solid ${P.border}`,
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const cardTitleStyle: CSSProperties = { margin: 0, fontSize: 13, fontWeight: 600 };
const hintStyle: CSSProperties = { margin: 0, fontSize: 12, color: P.muted };
const inputStyle: CSSProperties = {
  background: P.field,
  border: `1px solid ${P.border}`,
  borderRadius: 8,
  color: P.text,
  padding: "8px 10px",
  fontSize: 13,
  outline: "none",
};
const ghostButtonStyle: CSSProperties = {
  background: P.field,
  border: `1px solid ${P.border}`,
  borderRadius: 8,
  color: P.text,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
const primaryButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  background: P.accent,
  color: P.surface,
  borderColor: P.accent,
  fontWeight: 600,
};
