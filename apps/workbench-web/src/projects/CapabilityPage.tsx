import { Component, useCallback, type ReactNode } from "react";

import { ResourceMessage } from "../product-shell/ProductShell";
import { productClient } from "./productClient";
import type { ProductIdentity, ProductMountContext, ProductMounts } from "./productMounts";
import { routeHref, type ProductRoute } from "./productRoutes";
import { useResource } from "./useResource";

type CapabilityRoute = Extract<
  ProductRoute,
  { page: "assistant" | "new-workflow" | "workflow" | "dispatch" | "task" }
>;

const labels = {
  assistant: "项目助手",
  "new-workflow": "新建任务工作流",
  workflow: "工作流编辑器",
  dispatch: "派发任务",
  task: "任务详情",
};

export function CapabilityPage({
  route,
  mounts,
  identity,
}: {
  route: CapabilityRoute;
  mounts: ProductMounts;
  identity: ProductIdentity;
}) {
  const load = useCallback(
    (signal: AbortSignal) => productClient.project(route.projectId, signal),
    [route.projectId],
  );
  const { resource, retry } = useResource(load);
  const close = () => {
    window.location.hash = routeHref({ page: "project", projectId: route.projectId });
  };
  if (resource.status !== "ready")
    return (
      <main className="product-workspace">
        <ResourceMessage resource={resource} retry={retry} />
      </main>
    );
  const context: ProductMountContext = {
    project: resource.value,
    identity,
    navigate: (next) => {
      window.location.hash = routeHref(next);
    },
    onClose: close,
  };
  const mounted =
    route.page === "assistant"
      ? mounts.renderAssistant
      : route.page === "new-workflow"
        ? mounts.renderNewWorkflow
        : route.page === "task"
          ? mounts.renderTask
          : route.page === "dispatch"
            ? mounts.renderDispatch
            : mounts.renderWorkflow;
  if (!mounted)
    return (
      <main className="product-workspace">
        <h1>{labels[route.page]}</h1>
        <div className="product-error" role="alert">
          <p>{labels[route.page]}尚未挂载。当前项目和链接已保留，接入真实服务后可继续。</p>
          {"workflowId" in route && (
            <p>
              工作流 {route.workflowId} · 版本 {route.version}
            </p>
          )}
          {"taskId" in route && <p>任务 {route.taskId}</p>}
        </div>
        <button className="product-button" onClick={close}>
          返回项目
        </button>
      </main>
    );
  return (
    <MountBoundary onClose={close}>
      <MountedCapability route={route} mounts={mounts} context={context} />
    </MountBoundary>
  );
}

function MountedCapability({
  route,
  mounts,
  context,
}: {
  route: CapabilityRoute;
  mounts: ProductMounts;
  context: ProductMountContext;
}) {
  switch (route.page) {
    case "assistant":
      return mounts.renderAssistant!(context);
    case "new-workflow":
      return mounts.renderNewWorkflow!(context);
    case "task":
      return mounts.renderTask!({ ...context, taskId: route.taskId });
    case "dispatch":
      return mounts.renderDispatch!({
        ...context,
        workflow: { id: route.workflowId, version: route.version },
      });
    case "workflow":
      return mounts.renderWorkflow!({
        ...context,
        workflow: { id: route.workflowId, version: route.version },
      });
  }
}

class MountBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { error: string | null }
> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "功能加载失败。" };
  }
  override render() {
    return this.state.error ? (
      <main className="product-workspace">
        <div role="alert" className="product-error">
          {this.state.error}
        </div>
        <button className="product-button" onClick={() => this.setState({ error: null })}>
          重试
        </button>
        <button className="product-button" onClick={this.props.onClose}>
          返回项目
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
