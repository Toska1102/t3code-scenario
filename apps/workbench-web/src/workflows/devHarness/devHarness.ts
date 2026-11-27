/**
 * Standalone browser harness for 03.01. Serve this directory with any static
 * Vite-capable server (`vite apps/workbench-web/src/workflows/devHarness`)
 * and open index.html. It wires the editor to the in-memory store + workflow
 * service so every control is exercisable without the parent app.
 */
import { mountCreateWorkflowPanel } from "../mountCreateWorkflowPanel.ts";
import { mountWorkflowEditor } from "../mountWorkflowEditor.ts";
import { createWorkflowService } from "../../../../../packages/workbench-core/src/workflow/service.ts";
import { createMemoryWorkflowStore } from "../../../../../packages/workbench-core/src/workflow/store.ts";
import { createMemoryProjectStore } from "../../../../../packages/workbench-core/src/projects/store.ts";
import { createProjectService } from "../../../../../packages/workbench-core/src/projects/service.ts";
import type {
  TeamGraphSnapshot,
  WorkflowDraft,
} from "../../../../../packages/workbench-contracts/src/workflow/types.ts";

const teamGraph: TeamGraphSnapshot = {
  teamId: "team-1",
  teamName: "招聘运营",
  revision: 1,
  nodes: [
    {
      id: "hr",
      name: "HR 总管",
      parents: [],
      binding: { kind: "human", personName: "王总" },
      tools: "读取文件",
      tokens: 4000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "od",
      name: "OD",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "od-agent", agentName: "claude" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [{ reviewerNodeId: "hr", taskTypeKeywords: ["简历"] }],
    },
    {
      id: "recruit",
      name: "招聘",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "recruit-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "td",
      name: "TD",
      parents: ["od", "recruit"],
      binding: { kind: "agent", instanceId: "td-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "cb",
      name: "C&B",
      parents: ["hr"],
      binding: null,
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "culture",
      name: "Culture",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "culture-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "ssc",
      name: "SSC",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "ssc-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "ta",
      name: "TA",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "ta-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
    {
      id: "er",
      name: "ER",
      parents: ["hr"],
      binding: { kind: "agent", instanceId: "er-agent", agentName: "codex" },
      tools: "读写文件",
      tokens: 8000,
      model: "Claude Sonnet",
      reviewRules: [],
    },
  ],
};

const service = createWorkflowService({
  store: createMemoryWorkflowStore(),
  currentTeamGraph: async () => teamGraph,
  newId: (prefix) => `${prefix}-demo`,
  now: () => "2026-11-27T00:00:00.000Z",
  actor: () => "admin",
});

// 02.01 新建任务工作流 → 03.01 编辑器: the vertical slice of ticket 04.
const projectStore = createMemoryProjectStore();
const workflowStore = createMemoryWorkflowStore();
const projectService = createProjectService({
  store: projectStore,
  workflowStore,
  workflow: {
    loadDraft: (id) => service.loadDraft(id),
    listHistory: (id) => service.listHistory(id),
    createDraft: (input) => service.createDraft(input),
  },
  countDispatches: async () => 0,
  newId: (prefix) => `${prefix}-demo`,
  now: () => "2026-11-27T00:00:00.000Z",
});
const project = await projectService.createProject({
  name: "校招项目",
  teamId: "team-1",
  teamName: "招聘运营",
});
if (!project.ok) throw new Error("harness setup failed");

const createPanelContainer = document.createElement("div");
document.body.append(createPanelContainer);

mountCreateWorkflowPanel({
  container: createPanelContainer,
  operations: {
    createWorkflowDraft: (input) =>
      projectService.createWorkflowDraft(project.value.id, input, {
        key: `harness-${input.description?.length}`,
      }),
  },
  onCreated: (created) => {
    createPanelContainer.replaceChildren();
    mountEditor(created);
  },
});

function mountEditor(draft: WorkflowDraft): void {
  const container = document.createElement("div");
  document.body.append(container);

  mountWorkflowEditor({
    container,
    draft,
    teamGraph,
    project: { teamName: "招聘运营" },
    agentSummary: { total: 3, available: 2 },
    operations: {
      saveDraft: (value) => service.saveDraft(value),
      confirmDraft: (value) => service.confirmDraft(value.id),
      generateSteps: (value) => service.generateSteps(value.id),
      listHistory: (id) => service.listHistory(id),
      startRevision: (id, versionNumber) => service.startRevision(id, versionNumber),
      loadDraft: (id) => service.loadDraft(id),
    },
    confirm: (message) => window.confirm(message),
    onContinueDispatch: (value, version) => {
      window.alert(
        version
          ? `继续首次派发：${version.name} v${version.versionNumber}`
          : `继续首次派发：${value.name}`,
      );
    },
  });
}
