import type { ReactNode } from "react";

import type { AgentConnectionsGateway } from "../../../../packages/workbench-core/src/agents/application/AgentConnectionsGateway";
import type { OrganizationDialogProps } from "../../features/teams/organization";
import type { Project } from "./productClient";
import type { ProductRoute } from "./productRoutes";

export interface ProductIdentity {
  authenticated: boolean;
  sessionId?: string;
  scopes?: readonly string[];
}

export interface WorkflowLink {
  id: string;
  version: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  statusLabel: string;
  needsReview: boolean;
  workflow: WorkflowLink & { name: string };
}

export interface ProjectWorkflow extends WorkflowLink {
  name: string;
  description: string;
  state: "draft" | "confirmed";
}

export interface ProductMountContext {
  project: Project;
  identity: ProductIdentity;
  navigate: (route: ProductRoute) => void;
  onClose: () => void;
}

export interface ProductMounts {
  agentGateway?: AgentConnectionsGateway;
  loadOrganizationReferences?: (
    teamId: string,
    signal: AbortSignal,
  ) => Promise<
    Pick<
      OrganizationDialogProps,
      "people" | "agentInstances" | "workflowUsageByNode" | "availableTools" | "availableModels"
    >
  >;
  loadProjectActivity?: (
    projectId: string,
    signal: AbortSignal,
  ) => Promise<{ tasks: ProjectTask[]; workflows: ProjectWorkflow[] }>;
  createWorkflow?: (input: {
    projectId: string;
    prompt: string;
    attachments: readonly File[];
  }) => Promise<WorkflowLink>;
  renderAssistant?: (context: ProductMountContext) => ReactNode;
  renderNewWorkflow?: (context: ProductMountContext) => ReactNode;
  renderWorkflow?: (context: ProductMountContext & { workflow: WorkflowLink }) => ReactNode;
  renderDispatch?: (context: ProductMountContext & { workflow: WorkflowLink }) => ReactNode;
  renderTask?: (context: ProductMountContext & { taskId: string }) => ReactNode;
}
