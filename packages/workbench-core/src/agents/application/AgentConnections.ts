import {
  SECRET_MASK,
  isInstanceAvailable,
  summarizeInstances,
  type AgentDeviceSummary,
  type AgentEnvVar,
  type AgentInstance,
  type AgentInstanceModel,
  type AgentLaunchConfig,
  type ConnectionCheckResult,
} from "../domain/AgentAvailability.ts";
import type { AgentConnectionsOptions } from "./AgentInstanceStore.ts";

export type AgentConnectionErrorCode =
  | "instance_not_found"
  | "default_unavailable"
  | "invalid_env_var"
  | "duplicate_env_var"
  | "invalid_model_id"
  | "duplicate_model_id"
  | "probe_unconfigured";

// @effect-diagnostics-next-line extendsNativeError:off -- This error also crosses the framework-independent browser gateway.
export class AgentConnectionError extends Error {
  readonly code: AgentConnectionErrorCode;
  readonly field: string | undefined;
  constructor(code: AgentConnectionErrorCode, field?: string) {
    super(code);
    this.code = code;
    this.field = field;
    this.name = "AgentConnectionError";
  }
}

/** Editable configuration held as the per-instance dialog draft. */
export interface AgentInstanceDraft {
  launch: AgentLaunchConfig;
  envVars: AgentEnvVar[];
}

export interface SetInstanceEnabledResult {
  impact: {
    blocksNewDispatch: boolean;
    startedStepsContinueOnSnapshot: boolean;
    queuedStepsRecheckBeforeStart: boolean;
  };
}

export interface ConnectionCheckOutcome extends ConnectionCheckResult {
  evaluatedOrigin: "saved" | "draft";
}

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODEL_ID_PATTERN = /^[^\s]+$/;

export class AgentConnections {
  readonly #store: AgentConnectionsOptions["store"];
  readonly #probe: AgentConnectionsOptions["probe"];

  constructor(options: AgentConnectionsOptions) {
    this.#store = options.store;
    this.#probe = options.probe;
  }

  async getSnapshot(): Promise<AgentDeviceSummary> {
    return summarizeInstances(await this.#store.load());
  }

  /**
   * Persists the editable draft of one instance. The mask is a sentinel the
   * client holds in place of plaintext: a masked value keeps the stored
   * secret under the same name, starts empty under a new name, and may not
   * be demoted to non-secret (that would store the mask as plaintext).
   */
  async saveInstance(instanceId: string, draft: AgentInstanceDraft): Promise<AgentDeviceSummary> {
    validateEnvVars(draft.envVars);
    await this.#mutate(instanceId, (instance) => {
      instance.launch = draft.launch;
      instance.envVars = draft.envVars.map((envVar) => {
        if (envVar.value !== SECRET_MASK) return { ...envVar };
        if (!envVar.secret) throw new AgentConnectionError("invalid_env_var", envVar.name);
        const stored = instance.envVars.find((candidate) => candidate.name === envVar.name);
        return { ...envVar, value: stored?.value ?? "" };
      });
    });
    return this.getSnapshot();
  }

  /**
   * R09: disabling blocks new dispatches immediately; started steps continue
   * on their execution snapshot and queued steps re-check before launch.
   */
  async setInstanceEnabled(
    instanceId: string,
    enabled: boolean,
  ): Promise<SetInstanceEnabledResult> {
    await this.#mutate(instanceId, (instance) => {
      instance.enabled = enabled;
    });
    return {
      impact: {
        blocksNewDispatch: !enabled,
        startedStepsContinueOnSnapshot: true,
        queuedStepsRecheckBeforeStart: true,
      },
    };
  }

  /** R13: promoting an instance replaces the previous default. */
  async setDefaultInstance(instanceId: string): Promise<AgentDeviceSummary> {
    await this.#mutate(instanceId, (instance, instances) => {
      if (!isInstanceAvailable(instance)) {
        throw new AgentConnectionError("default_unavailable");
      }
      for (const other of instances) other.isDefault = other === instance;
    });
    return this.getSnapshot();
  }

  /**
   * Health check evaluates executable, args, auth and model discovery. It
   * records only the observation: edits and the draft stay untouched.
   */
  async checkConnection(
    instanceId: string,
    input: { draft?: AgentInstanceDraft } = {},
  ): Promise<ConnectionCheckOutcome> {
    if (!this.#probe) throw new AgentConnectionError("probe_unconfigured");
    const instances = await this.#store.load();
    const instance = requireInstance(instances, instanceId);
    const draft = input.draft;
    if (draft) validateEnvVars(draft.envVars);
    const launch = draft ? draft.launch : instance.launch;
    // The draft carries masked secrets; probe with the stored values instead
    // so a draft check can actually authenticate.
    const envVars = draft
      ? draft.envVars.map((envVar) => {
          if (envVar.value !== SECRET_MASK) return envVar;
          const stored = instance.envVars.find((candidate) => candidate.name === envVar.name);
          return { ...envVar, value: stored?.value ?? "" };
        })
      : instance.envVars;
    const fromDraft = draft !== undefined;

    const result = await this.#probe.probe({
      instanceId,
      provider: instance.provider,
      launch,
      envVars,
    });
    const outcome: ConnectionCheckOutcome = {
      ...result,
      evaluatedOrigin: fromDraft ? "draft" : "saved",
    };

    await this.#mutate(instanceId, (target) => {
      target.lastCheck = {
        checkedAt: outcome.checkedAt,
        status: outcome.status,
        message: outcome.message,
        ...(outcome.modelsDiscovered ? { modelsDiscovered: outcome.modelsDiscovered } : {}),
      };
    });
    return outcome;
  }

  /** R08: a custom model ID enters as unverified; verification is separate. */
  async addCustomModel(instanceId: string, modelId: string): Promise<AgentDeviceSummary> {
    const normalized = modelId.trim();
    if (!normalized || !MODEL_ID_PATTERN.test(normalized)) {
      throw new AgentConnectionError("invalid_model_id", "modelId");
    }
    await this.#mutate(instanceId, (instance) => {
      if (instance.models.some((model) => model.id === normalized)) {
        throw new AgentConnectionError("duplicate_model_id", "modelId");
      }
      const model: AgentInstanceModel = {
        id: normalized,
        label: normalized,
        source: "custom",
        verified: false,
        enabled: false,
        favorite: false,
      };
      instance.models = [...instance.models, model];
    });
    return this.getSnapshot();
  }

  async setModelEnabled(
    instanceId: string,
    modelId: string,
    enabled: boolean,
  ): Promise<AgentDeviceSummary> {
    await this.#mutateModel(instanceId, modelId, (model) => {
      model.enabled = enabled;
    });
    return this.getSnapshot();
  }

  async setModelFavorite(
    instanceId: string,
    modelId: string,
    favorite: boolean,
  ): Promise<AgentDeviceSummary> {
    await this.#mutateModel(instanceId, modelId, (model) => {
      model.favorite = favorite;
    });
    return this.getSnapshot();
  }

  async #mutate(
    instanceId: string,
    mutate: (instance: AgentInstance, instances: AgentInstance[]) => void,
  ): Promise<void> {
    const instances = await this.#store.load();
    mutate(requireInstance(instances, instanceId), instances);
    await this.#store.save(instances);
  }

  async #mutateModel(
    instanceId: string,
    modelId: string,
    mutate: (model: AgentInstanceModel) => void,
  ): Promise<void> {
    await this.#mutate(instanceId, (instance) => {
      const model = instance.models.find((candidate) => candidate.id === modelId);
      if (!model) throw new AgentConnectionError("instance_not_found");
      mutate(model);
    });
  }
}

function requireInstance(instances: AgentInstance[], instanceId: string): AgentInstance {
  const instance = instances.find((candidate) => candidate.instanceId === instanceId);
  if (!instance) throw new AgentConnectionError("instance_not_found");
  return instance;
}

function validateEnvVars(envVars: AgentEnvVar[]): void {
  const seen = new Set<string>();
  for (const envVar of envVars) {
    const name = envVar.name.trim();
    if (!name || !ENV_VAR_NAME_PATTERN.test(name)) {
      throw new AgentConnectionError("invalid_env_var", envVar.name || undefined);
    }
    if (seen.has(name)) throw new AgentConnectionError("duplicate_env_var", name);
    seen.add(name);
  }
}
