import type {
  AgentInstanceDraft,
  ConnectionCheckOutcome,
  SetInstanceEnabledResult,
} from "./AgentConnections.ts";
import type { AgentDeviceSummary } from "../domain/AgentAvailability.ts";

/**
 * The client-facing port for the Agent connection dialog: the same use cases
 * as the AgentConnections application service, reached over HTTP. The dialog
 * and its view model depend on this interface, never on the server class.
 */
export interface AgentConnectionsGateway {
  getSnapshot(): Promise<AgentDeviceSummary>;
  saveInstance(instanceId: string, draft: AgentInstanceDraft): Promise<AgentDeviceSummary>;
  setInstanceEnabled(instanceId: string, enabled: boolean): Promise<SetInstanceEnabledResult>;
  setDefaultInstance(instanceId: string): Promise<AgentDeviceSummary>;
  checkConnection(
    instanceId: string,
    input?: { draft?: AgentInstanceDraft },
  ): Promise<ConnectionCheckOutcome>;
  addCustomModel(instanceId: string, modelId: string): Promise<AgentDeviceSummary>;
  setModelEnabled(
    instanceId: string,
    modelId: string,
    enabled: boolean,
  ): Promise<AgentDeviceSummary>;
  setModelFavorite(
    instanceId: string,
    modelId: string,
    favorite: boolean,
  ): Promise<AgentDeviceSummary>;
}
