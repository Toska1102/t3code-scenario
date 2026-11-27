import type {
  AgentConnections,
  AgentInstanceDraft,
  ConnectionCheckOutcome,
} from "../../../../packages/workbench-core/src/agents/application/AgentConnections.ts";
import type {
  AgentDeviceSummary,
  AgentEnvVar,
  AgentLaunchConfig,
} from "../../../../packages/workbench-core/src/agents/domain/AgentAvailability.ts";

export interface AgentConnectionsViewModelOptions {
  service: AgentConnections;
}

/**
 * Dialog state for the Agent connection boards (05.01–05.03). Each instance
 * keeps its own draft while the user switches between Pi, Codex and Claude
 * Code; saving, discarding and closing follow the shared modal exit rules.
 */
export function createAgentConnectionsViewModel({ service }: AgentConnectionsViewModelOptions) {
  let summary: AgentDeviceSummary = { totalCount: 0, availableCount: 0, instances: [] };
  let selectedInstanceId = "";
  const drafts = new Map<string, AgentInstanceDraft>();
  const lastChecks = new Map<string, ConnectionCheckOutcome>();
  let dirtyInstanceIds = new Set<string>();

  const draftForInstance = (instanceId: string): AgentInstanceDraft => {
    const existing = drafts.get(instanceId);
    if (existing) return existing;
    const instance = summary.instances.find((candidate) => candidate.instanceId === instanceId);
    return { launch: instance?.launch ?? {}, envVars: instance?.envVars ?? [] };
  };

  return {
    get summary() {
      return summary;
    },
    get selectedInstanceId() {
      return selectedInstanceId;
    },
    get hasUnsavedChanges() {
      return dirtyInstanceIds.size > 0;
    },
    draftFor: draftForInstance,
    lastCheckFor: (instanceId: string) => lastChecks.get(instanceId),

    async open() {
      summary = await service.getSnapshot();
      selectedInstanceId = summary.instances[0]?.instanceId ?? "";
    },

    selectInstance(instanceId: string) {
      selectedInstanceId = instanceId;
    },

    editLaunch(instanceId: string, launch: AgentLaunchConfig) {
      drafts.set(instanceId, {
        ...draftForInstance(instanceId),
        launch: { ...draftForInstance(instanceId).launch, ...launch },
      });
      dirtyInstanceIds.add(instanceId);
    },

    editEnvVars(instanceId: string, envVars: AgentEnvVar[]) {
      drafts.set(instanceId, { ...draftForInstance(instanceId), envVars });
      dirtyInstanceIds.add(instanceId);
    },

    async saveSelected() {
      const instanceId = selectedInstanceId;
      summary = await service.saveInstance(instanceId, draftForInstance(instanceId));
      drafts.delete(instanceId);
      dirtyInstanceIds.delete(instanceId);
    },

    discardSelected() {
      drafts.delete(selectedInstanceId);
      dirtyInstanceIds.delete(selectedInstanceId);
    },

    async setEnabled(instanceId: string, enabled: boolean) {
      await service.setInstanceEnabled(instanceId, enabled);
      summary = await service.getSnapshot();
    },

    async setDefault(instanceId: string) {
      summary = await service.setDefaultInstance(instanceId);
    },

    async checkSelected() {
      const instanceId = selectedInstanceId;
      const outcome = await service.checkConnection(instanceId, {
        draft: dirtyInstanceIds.has(instanceId) ? draftForInstance(instanceId) : undefined,
      });
      lastChecks.set(instanceId, outcome);
      summary = await service.getSnapshot();
      return outcome;
    },
  };
}

export type AgentConnectionsViewModel = ReturnType<typeof createAgentConnectionsViewModel>;
