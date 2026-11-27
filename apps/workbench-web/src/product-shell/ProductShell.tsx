import type { ReactNode } from "react";

import { routeHref, type ProductRoute } from "../projects/productRoutes";
import type { Resource } from "../projects/useResource";
import "./productShell.css";

export function ProductShell({
  children,
  breadcrumb,
  back,
  onAgents,
  agentStatus,
}: {
  children: ReactNode;
  breadcrumb?: string | undefined;
  back?: ProductRoute | undefined;
  onAgents: () => void;
  agentStatus?: string | undefined;
}) {
  return (
    <div className="product-shell">
      <header className="product-nav">
        <a className="product-brand" href={routeHref({ page: "home" })} aria-label="团队首页">
          <span>A</span>
          <strong>{breadcrumb ?? "团队首页"}</strong>
        </a>
        <div className="product-actions">
          {back && (
            <a className="product-button" href={routeHref(back)}>
              返回项目列表
            </a>
          )}
          <button className="product-button" onClick={onAgents}>
            Agent 连接 <small>{agentStatus ?? "未检测"}</small>
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}

export function ResourceMessage({
  resource,
  retry,
}: {
  resource: Resource<unknown>;
  retry: () => void;
}) {
  if (resource.status === "ready") return null;
  if (resource.status === "loading")
    return (
      <p className="product-muted" role="status">
        加载中…
      </p>
    );
  return (
    <div className="product-error" role="alert">
      <p>{resource.message}</p>
      <button className="product-button" onClick={retry}>
        重试
      </button>
    </div>
  );
}
