import { useState, useSyncExternalStore } from "react";

import { ProductShell } from "../product-shell/ProductShell";
import { useWorkbenchIdentity } from "../WorkbenchSession";
import { AgentsMount, CreateTeamDialog, OrganizationMount } from "./ProductDialogs";
import { CapabilityPage } from "./CapabilityPage";
import { ProjectDetail } from "./ProjectDetail";
import { ProjectEditor } from "./ProjectEditor";
import { ProjectList } from "./ProjectList";
import type { ProductMounts } from "./productMounts";
import { parseProductRoute, routeHref } from "./productRoutes";
import { TeamHome } from "./TeamHome";

const defaultMounts: ProductMounts = {};

function subscribeRoute(changed: () => void) {
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
}

export function ProductApp({ mounts = defaultMounts }: { mounts?: ProductMounts }) {
  const hash = useSyncExternalStore(subscribeRoute, () => window.location.hash);
  const route = parseProductRoute(hash);
  const identity = useWorkbenchIdentity();
  const [dialog, setDialog] = useState<
    { page: "agents" | "create-team" } | { page: "organization"; teamId: string }
  >();
  const [revision, setRevision] = useState(0);
  const [agentStatus, setAgentStatus] = useState<string>();
  function organization(teamId: string) {
    setDialog({ page: "organization", teamId });
  }
  function changed() {
    setRevision((value) => value + 1);
  }
  const back =
    route.page === "home" || route.page === "projects"
      ? undefined
      : { page: "projects" as const, teamId: null };
  return (
    <ProductShell
      onAgents={() => setDialog({ page: "agents" })}
      agentStatus={agentStatus}
      back={back}
      breadcrumb={route.page === "home" ? undefined : "Agent 团队工作台 / 项目"}
    >
      <div key={`${hash}:${revision}`}>
        {route.page === "home" ? (
          <TeamHome
            onOrganization={organization}
            onCreateTeam={() => setDialog({ page: "create-team" })}
          />
        ) : route.page === "projects" ? (
          <ProjectList teamId={route.teamId} onOrganization={organization} />
        ) : route.page === "create" ? (
          <ProjectEditor teamId={route.teamId} />
        ) : route.page === "settings" ? (
          <ProjectEditor projectId={route.projectId} teamId={null} />
        ) : route.page === "project" ? (
          <ProjectDetail
            projectId={route.projectId}
            mounts={mounts}
            onOrganization={organization}
            onSettings={() => {
              window.location.hash = routeHref({ page: "settings", projectId: route.projectId });
            }}
          />
        ) : route.page === "not-found" ? (
          <main className="product-workspace">
            <h1>页面不存在</h1>
            <a className="product-button" href={routeHref({ page: "home" })}>
              返回团队首页
            </a>
          </main>
        ) : (
          <CapabilityPage route={route} mounts={mounts} identity={identity} />
        )}
      </div>
      {dialog?.page === "organization" && (
        <OrganizationMount
          teamId={dialog.teamId}
          mounts={mounts}
          onClose={() => setDialog(undefined)}
          onSaved={changed}
        />
      )}
      {dialog?.page === "agents" && (
        <AgentsMount
          mounts={mounts}
          onClose={() => setDialog(undefined)}
          onSummary={setAgentStatus}
        />
      )}
      {dialog?.page === "create-team" && (
        <CreateTeamDialog
          onClose={() => setDialog(undefined)}
          onSaved={() => {
            changed();
            setDialog(undefined);
          }}
        />
      )}
    </ProductShell>
  );
}
