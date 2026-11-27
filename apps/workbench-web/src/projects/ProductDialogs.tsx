import { useCallback, useState, type FormEvent } from "react";

import { AgentConnectionsDialog } from "../../features/agents";
import { OrganizationDialog } from "../../features/teams/organization";
import { ProductModal } from "../product-shell/ProductModal";
import { ResourceMessage } from "../product-shell/ProductShell";
import { productClient } from "./productClient";
import { browserAgentGateway } from "./agentClient";
import type { ProductMounts } from "./productMounts";
import { useResource } from "./useResource";

export function OrganizationMount({
  teamId,
  mounts,
  onClose,
  onSaved,
}: {
  teamId: string;
  mounts: ProductMounts;
  onClose: () => void;
  onSaved: () => void;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [stored, teams] = await Promise.all([
        productClient.organization(teamId, signal),
        productClient.teams(signal),
      ]);
      const team = teams.teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new Error("此团队不存在。");
      const references = mounts.loadOrganizationReferences
        ? await mounts.loadOrganizationReferences(teamId, signal)
        : { people: [], agentInstances: [], availableModels: [], availableTools: [] };
      return { stored, team, references };
    },
    [teamId, mounts.loadOrganizationReferences],
  );
  const { resource, retry } = useResource(load);
  if (resource.status !== "ready")
    return (
      <ProductModal title="组织架构" onClose={onClose}>
        <ResourceMessage resource={resource} retry={retry} />
      </ProductModal>
    );
  return (
    <OrganizationDialog
      team={{ id: teamId, ...resource.value.stored.team }}
      revision={resource.value.stored.revision}
      organization={resource.value.stored.organization}
      {...resource.value.references}
      onClose={onClose}
      onSave={async (input) => {
        try {
          const result = await productClient.saveOrganization(teamId, input);
          onSaved();
          return { ok: true, revision: result.revision };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : "组织保存失败，请重试。",
          };
        }
      }}
    />
  );
}

export function AgentsMount({
  mounts,
  onClose,
  onSummary,
}: {
  mounts: ProductMounts;
  onClose: () => void;
  onSummary: (label: string) => void;
}) {
  const gateway = mounts.agentGateway ?? browserAgentGateway;
  const load = useCallback(async () => {
    const summary = await gateway.getSnapshot();
    onSummary(`${summary.availableCount} / ${summary.totalCount} 可用`);
    return summary;
  }, [gateway, onSummary]);
  const { resource, retry } = useResource(load);
  if (resource.status !== "ready")
    return (
      <ProductModal title="Agent 连接" onClose={onClose}>
        <ResourceMessage resource={resource} retry={retry} />
      </ProductModal>
    );
  if (resource.value.totalCount === 0)
    return (
      <ProductModal title="Agent 连接" onClose={onClose}>
        <p>服务器尚未提供 Agent 实例。请在 T3 服务器配置 Provider 后重试。</p>
        <button className="product-button" onClick={retry}>
          重新检测
        </button>
      </ProductModal>
    );
  return <AgentConnectionsDialog gateway={gateway} open onClose={onClose} />;
}

export function CreateTeamDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  // @effect-diagnostics-next-line cryptoRandomUUID:off -- The browser creates one idempotency key per form submission.
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    try {
      await productClient.createTeam({
        requestId,
        name,
        description: String(data.get("description") ?? "").trim() || null,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "团队保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ProductModal
      title="新建团队"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label>
            团队名称 *<input name="name" required autoFocus />
          </label>
          <label>
            团队说明
            <textarea name="description" />
          </label>
        </fieldset>
        {error && (
          <p className="product-error" role="alert">
            {error}
          </p>
        )}
        <footer className="product-actions">
          <button type="submit" className="product-button product-primary" disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
        </footer>
      </form>
    </ProductModal>
  );
}
