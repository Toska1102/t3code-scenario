import type {
  AgentInstance,
  AgentLaunchConfig,
  ConnectionCheckResult,
} from "../domain/AgentAvailability.ts";

export interface AgentInstanceStore {
  load(): Promise<AgentInstance[]>;
  save(instances: AgentInstance[]): Promise<void>;
}

/** One health probe attempt against a concrete launch configuration. */
export interface AgentHealthProbeInput {
  instanceId: string;
  provider: AgentInstance["provider"];
  launch: AgentLaunchConfig;
  envVars: AgentInstance["envVars"];
}

export interface AgentHealthProbe {
  probe(input: AgentHealthProbeInput): Promise<ConnectionCheckResult>;
}

export interface AgentConnectionsOptions {
  store: AgentInstanceStore;
  probe?: AgentHealthProbe;
}
