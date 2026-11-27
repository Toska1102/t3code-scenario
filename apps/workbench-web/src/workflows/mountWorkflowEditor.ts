import {
  DISPATCH_INPUT_FIELD_KIND_LABEL,
  WORKFLOW_STEP_MODE_LABEL,
  type TeamGraphSnapshot,
  type WorkflowDraft,
  type WorkflowVersionRecord,
  edgeId,
} from "../../../../packages/workbench-contracts/src/workflow/types.ts";
import { candidatePool } from "../../../../packages/workbench-core/src/workflow/members.ts";
import type { DependencyEdge } from "../../../../packages/workbench-core/src/workflow/graph.ts";
import { workflowEditorCss } from "./designTokens.ts";
import {
  WorkflowEditorController,
  type WorkflowEditorCallbacks,
  type WorkflowEditorOperations,
} from "./WorkflowEditorController.ts";

export interface WorkflowEditorMountOptions {
  container: HTMLElement;
  draft: WorkflowDraft;
  teamGraph: TeamGraphSnapshot;
  versions?: WorkflowVersionRecord[];
  project: { teamName: string; pageName?: string };
  agentSummary: { total: number; available: number };
  operations: WorkflowEditorOperations;
  confirm?: (message: string) => boolean | Promise<boolean>;
  onBackToProject?(): void;
  onContinueDispatch?(draft: WorkflowDraft, version: WorkflowVersionRecord | null): void;
  onOpenAgentConnections?(): void;
}

export interface WorkflowEditorHandle {
  controller: WorkflowEditorController;
  destroy(): void;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = workflowEditorCss();
  document.head.append(style);
  styleInjected = true;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  className: string,
  text: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = "button";
  node.disabled = disabled;
  node.addEventListener("click", onClick);
  return node;
}

function labeled(label: string, input: HTMLElement, required = false): HTMLDivElement {
  const wrap = el("div");
  const labelNode = el("label", "wb-field-label", required ? `${label} *` : label);
  labelNode.htmlFor = "";
  wrap.append(labelNode, input);
  return wrap;
}

function worldTransform(zoom: number): string {
  return `translate(-50%, -50%) scale(${zoom})`;
}

/**
 * Standalone browser component for 03.01 工作流编辑器 (stories 21–27).
 * Framework-free; mounts into any container and renders from the controller.
 */
export function mountWorkflowEditor(options: WorkflowEditorMountOptions): WorkflowEditorHandle {
  injectStyle();
  const { container } = options;
  const callbacks: WorkflowEditorCallbacks = {
    confirm: (message) => {
      const handler =
        options.confirm ??
        ((text: string) => (typeof window !== "undefined" ? window.confirm(text) : true));
      return handler(message);
    },
  };
  if (options.onBackToProject) callbacks.onBackToProject = options.onBackToProject;
  if (options.onContinueDispatch) callbacks.onContinueDispatch = options.onContinueDispatch;
  const controller = new WorkflowEditorController(
    options.operations,
    callbacks,
    options.draft,
    options.teamGraph,
    options.versions ?? [],
  );

  let destroyed = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      controller.getState().selectedEdge
    ) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      controller.deleteSelectedEdge();
    }
  };
  document.addEventListener("keydown", onKeyDown);

  const render = (): void => {
    if (destroyed) return;
    container.replaceChildren(renderEditor());
  };

  const unsubscribe = controller.subscribe(render);
  render();

  return {
    controller,
    destroy() {
      destroyed = true;
      unsubscribe();
      document.removeEventListener("keydown", onKeyDown);
      container.replaceChildren();
    },
  };

  // ── rendering ─────────────────────────────────────────────────────────

  function renderEditor(): HTMLElement {
    const state = controller.getState();
    const root = el("div", "wb-workflow-editor");
    root.append(renderNav());
    const page = el("div", "wb-page");
    page.append(renderTitleRow(state));
    page.append(renderDescribePanel(state));
    page.append(renderCanvasPanel(state));
    page.append(renderStepConfigPanel(state));
    page.append(renderFooter(state));
    root.append(page);
    return root;
  }

  function renderNav(): HTMLElement {
    const nav = el("div", "wb-nav");
    const crumbs = el("div", "wb-crumbs");
    const avatar = el("span", "wb-avatar", "A");
    crumbs.append(
      avatar,
      el("span", "wb-crumb-team", options.project.teamName),
      el("span", "wb-crumb-sep", "/"),
      el("span", "wb-crumb-page", options.project.pageName ?? "任务工作流"),
    );
    const badge = button("wb-agent-badge", "", () => options.onOpenAgentConnections?.());
    badge.append(
      el("strong", undefined, "Agent 连接"),
      el(
        "span",
        undefined,
        `${options.agentSummary.available} / ${options.agentSummary.total} 可用`,
      ),
    );
    nav.append(crumbs, badge);
    return nav;
  }

  function renderTitleRow(state: ReturnType<WorkflowEditorController["getState"]>): HTMLElement {
    const row = el("div", "wb-title-row");
    const left = el("div");
    left.append(el("h1", undefined, "配置任务工作流"));
    const subtitle = el("div", "wb-subtitle", controller.subtitle());
    const historyButton = button(
      "wb-btn wb-btn-ghost",
      state.historyOpen ? "收起历史" : "历史版本",
      () => void controller.openHistory(),
    );
    subtitle.append(historyButton);
    left.append(subtitle);
    if (state.historyOpen) {
      const list = el("div", "wb-history-list");
      if (!state.versions.length) list.append(el("div", "wb-history-row", "还没有已确认的版本。"));
      for (const version of [...state.versions].reverse()) {
        const rowNode = el("div", "wb-history-row");
        rowNode.append(
          el("span", "wb-history-name", `v${version.versionNumber} · ${version.name}`),
          el("span", "wb-history-meta", `${version.confirmedAt} · ${version.confirmedBy}`),
          button(
            "wb-btn wb-btn-outline",
            "编辑流程",
            () => void controller.editVersion(version.versionNumber),
          ),
        );
        list.append(rowNode);
      }
      left.append(list);
    }
    const ioRow = el("div", "wb-io-row");
    const fieldSummary =
      state.draft.inputFields.map((field) => field.label).join("、") || "未定义派发输入";
    const inputs = el("div", "wb-io");
    inputs.append(el("div", "wb-io-label", "派发输入"));
    const inputsBox = el("div", "wb-io-box", fieldSummary);
    inputsBox.setAttribute("role", "button");
    inputsBox.setAttribute("aria-label", "编辑派发输入字段");
    inputsBox.addEventListener("click", () => controller.toggleFieldsOpen());
    inputs.append(inputsBox);
    const deliverable = el("div", "wb-io");
    deliverable.append(el("div", "wb-io-label", "交付物"));
    const deliverableInput = el("input");
    deliverableInput.value = state.draft.deliverable;
    deliverableInput.placeholder = "最终交付的产物";
    deliverableInput.addEventListener("input", () =>
      controller.setDeliverable(deliverableInput.value),
    );
    deliverable.append(deliverableInput);
    ioRow.append(inputs, deliverable);
    row.append(left, ioRow);
    if (state.fieldsOpen) {
      row.append(renderFieldsEditor(state));
    }
    return row;
  }

  function renderFieldsEditor(
    state: ReturnType<WorkflowEditorController["getState"]>,
  ): HTMLElement {
    const editor = el("div", "wb-fields-editor");
    editor.style.flexBasis = "100%";
    for (const field of state.draft.inputFields) {
      const row = el("div", "wb-field-row");
      const label = el("input");
      label.value = field.label;
      label.placeholder = "标签";
      label.addEventListener("change", () => {
        controller.setInputFields(
          state.draft.inputFields.map((candidate) =>
            candidate.key === field.key ? { ...candidate, label: label.value } : candidate,
          ),
        );
      });
      const key = el("input");
      key.value = field.key;
      key.placeholder = "稳定标识";
      key.addEventListener("change", () => {
        controller.setInputFields(
          state.draft.inputFields.map((candidate) =>
            candidate.key === field.key ? { ...candidate, key: key.value } : candidate,
          ),
        );
      });
      const kind = el("select");
      for (const [value, text] of Object.entries(DISPATCH_INPUT_FIELD_KIND_LABEL)) {
        const option = el("option", undefined, text);
        (option as HTMLOptionElement).value = value;
        if (value === field.kind) option.selected = true;
        kind.append(option);
      }
      kind.addEventListener("change", () => {
        controller.setInputFields(
          state.draft.inputFields.map((candidate) =>
            candidate.key === field.key
              ? { ...candidate, kind: kind.value as typeof field.kind }
              : candidate,
          ),
        );
      });
      const required = el("select");
      for (const [value, text] of [
        ["required", "必填"],
        ["optional", "选填"],
      ] as const) {
        const option = el("option", undefined, text);
        (option as HTMLOptionElement).value = value;
        if ((value === "required") === field.required) option.selected = true;
        required.append(option);
      }
      required.addEventListener("change", () => {
        controller.setInputFields(
          state.draft.inputFields.map((candidate) =>
            candidate.key === field.key
              ? { ...candidate, required: required.value === "required" }
              : candidate,
          ),
        );
      });
      const description = el("input");
      description.value = field.description;
      description.placeholder = "说明";
      description.addEventListener("change", () => {
        controller.setInputFields(
          state.draft.inputFields.map((candidate) =>
            candidate.key === field.key
              ? { ...candidate, description: description.value }
              : candidate,
          ),
        );
      });
      row.append(
        label,
        key,
        kind,
        required,
        description,
        button("wb-btn wb-btn-danger", "删除", () => void controller.removeInputField(field.key)),
      );
      editor.append(row);
    }
    editor.append(
      button(
        "wb-btn wb-btn-outline",
        "添加输入字段",
        () => {
          const key = `field-${state.draft.inputFields.length + 1}`;
          controller.setInputFields([
            ...state.draft.inputFields,
            { key, label: "新字段", kind: "shortText", required: false, description: "" },
          ]);
        },
        !state.fieldsOpen,
      ),
    );
    return editor;
  }

  function renderDescribePanel(
    state: ReturnType<WorkflowEditorController["getState"]>,
  ): HTMLElement {
    const panel = el("div", "wb-panel");
    const head = el("div", "wb-panel-head");
    const headText = el("div");
    headText.append(
      el("h2", undefined, "描述工作并选择参与成员"),
      el("p", "wb-hint", "项目助手会根据描述和成员职责生成步骤草稿。"),
    );
    head.append(
      headText,
      button(
        "wb-btn wb-btn-outline",
        state.status === "generating" ? "正在生成…" : "重新生成草稿",
        () => void controller.regenerate(),
        state.status !== "idle",
      ),
    );
    panel.append(head);

    const form = el("div", "wb-form-grid");
    const nameInput = el("input");
    nameInput.value = state.draft.name;
    nameInput.placeholder = "例如：简历审核";
    nameInput.addEventListener("input", () => controller.setName(nameInput.value));
    form.append(labeled("任务名称", nameInput, true));
    const descriptionInput = el("textarea");
    descriptionInput.value = state.draft.description;
    descriptionInput.rows = 3;
    descriptionInput.placeholder =
      "我想审核一批研发岗简历。请整理每份简历和岗位要求的匹配依据，再由 HR 总管复核。";
    descriptionInput.addEventListener("input", () =>
      controller.setDescription(descriptionInput.value),
    );
    form.append(labeled("这件事通常怎么做", descriptionInput));
    panel.append(form);

    panel.append(el("div", "wb-field-label", "参与成员"));
    const chips = el("div", "wb-members");
    for (const chip of controller.memberChips()) {
      const node = el(
        "button",
        `wb-member-chip${chip.selected ? " is-selected" : ""}${chip.autoIncluded ? " is-auto" : ""}`,
      );
      node.type = "button";
      node.disabled = chip.autoIncluded;
      node.setAttribute("aria-pressed", chip.selected ? "true" : "false");
      node.append(el("span", "wb-member-dot"), el("span", "wb-member-name", chip.name));
      node.append(el("span", "wb-member-tag", chip.autoIncluded ? "自动带入" : chip.agentLabel));
      node.addEventListener("click", () => controller.toggleMember(chip.id));
      chips.append(node);
    }
    panel.append(chips);
    panel.append(el("p", "wb-members-caption", controller.membersCaption()));
    return panel;
  }

  function renderCanvasPanel(state: ReturnType<WorkflowEditorController["getState"]>): HTMLElement {
    const panel = el("div", "wb-panel");
    const toolbar = el("div", "wb-canvas-toolbar");
    toolbar.append(
      el("h2", undefined, "执行流程"),
      button("wb-btn wb-btn-outline", "添加步骤", () => controller.addStep()),
      button(
        "wb-btn wb-btn-outline",
        "自动布局",
        () => controller.autoLayoutSteps(),
        !state.draft.steps.length,
      ),
      el("span", "wb-canvas-hint", "拖动右侧圆点连接步骤 · 选中连线按 Delete 删除"),
    );
    panel.append(toolbar);
    panel.append(renderCanvas(state));
    return panel;
  }

  function renderCanvas(state: ReturnType<WorkflowEditorController["getState"]>): HTMLElement {
    const canvas = el("div", "wb-canvas");
    canvas.setAttribute("aria-label", "工作流依赖图");
    canvas.append(el("div", "wb-canvas-grid-dim"));
    const world = el("div", "wb-canvas-world");
    world.style.transform = worldTransform(state.zoom);
    if (!state.draft.steps.length) {
      world.append(
        el(
          "div",
          "wb-empty",
          "填写上方描述并选择成员后，点击「重新生成草稿」，或手动「添加步骤」。",
        ),
      );
      canvas.append(world);
      return canvas;
    }

    const nodeById = new Map(state.draft.steps.map((step) => [step.id, step]));
    const WIDTH = 200;
    const HEIGHT = 64;
    const center = (stepId: string) => {
      const step = nodeById.get(stepId)!;
      return { x: step.position.x + WIDTH / 2, y: step.position.y + HEIGHT / 2 };
    };

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wb-edges");
    const selectedEdgeId = controller.selectedEdgeId();
    for (const step of state.draft.steps) {
      for (const dependency of step.dependsOn) {
        const from = center(dependency);
        const to = center(step.id);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const bend = Math.max(60, Math.abs(to.x - from.x) / 2);
        path.setAttribute(
          "d",
          `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`,
        );
        path.setAttribute(
          "class",
          `wb-edge-path${selectedEdgeId === edgeId(dependency, step.id) ? " is-selected" : ""}`,
        );
        const edge: DependencyEdge = { from: dependency, to: step.id };
        path.addEventListener("click", (event) => {
          event.stopPropagation();
          controller.selectEdge(edge);
        });
        path.addEventListener("keydown", () => {});
        svg.append(path);
      }
    }
    world.append(svg);

    for (const step of state.draft.steps) {
      const node = el("div", `wb-node${state.selectedStepId === step.id ? " is-selected" : ""}`);
      node.style.left = `${step.position.x}px`;
      node.style.top = `${step.position.y}px`;
      const owner = state.teamGraph.nodes.find((candidate) => candidate.id === step.ownerId);
      node.append(
        el("strong", undefined, step.title || "未命名步骤"),
        el(
          "span",
          undefined,
          `${owner?.name ?? step.ownerId} · ${WORKFLOW_STEP_MODE_LABEL[step.mode]}`,
        ),
      );
      node.setAttribute(
        "aria-label",
        `${step.title}，${owner?.name ?? step.ownerId}，${WORKFLOW_STEP_MODE_LABEL[step.mode]}`,
      );
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        controller.selectStep(step.id);
      });

      const source = el("div", "wb-port is-source");
      source.setAttribute("aria-label", `从「${step.title}」连出`);
      source.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startConnect(step.id, event);
      });
      const target = el("div", "wb-port is-target");
      target.setAttribute("aria-label", `连入「${step.title}」`);
      target.addEventListener("pointerup", () => finishConnect(step.id));
      node.append(target, source);

      // Drag to move; layout changes never touch dependencies.
      node.addEventListener("pointerdown", (event) => {
        if (event.target !== node) return;
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY };
        const origin = { ...step.position };
        const onMove = (move: PointerEvent) => {
          controller.moveStep(step.id, {
            x: origin.x + (move.clientX - start.x) / state.zoom,
            y: origin.y + (move.clientY - start.y) / state.zoom,
          });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      world.append(node);
    }
    canvas.addEventListener("click", () => controller.selectStep(null));

    let pendingFrom: string | null = null;
    function startConnect(fromStepId: string, event: PointerEvent): void {
      pendingFrom = fromStepId;
      const onMove = () => {};
      const onUp = () => {
        pendingFrom = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      void event;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function finishConnect(toStepId: string): void {
      if (!pendingFrom) return;
      const from = pendingFrom;
      pendingFrom = null;
      const blocked = controller.connectSteps(from, toStepId);
      if (blocked) canvas.setAttribute("title", blocked);
      else canvas.removeAttribute("title");
    }

    const zoomControls = el("div", "wb-zoom");
    zoomControls.append(
      button("wb-zoom-in", "+", () => controller.zoomIn()),
      button("wb-zoom-out", "−", () => controller.zoomOut()),
      button("wb-zoom-fit", "⤢", () => controller.fitZoom()),
    );
    canvas.append(world, zoomControls);
    return canvas;
  }

  function renderStepConfigPanel(
    state: ReturnType<WorkflowEditorController["getState"]>,
  ): HTMLElement {
    const panel = el("div", "wb-panel");
    const step = state.draft.steps.find((candidate) => candidate.id === state.selectedStepId);
    if (!step) {
      panel.append(
        el("h2", undefined, "步骤配置"),
        el(
          "p",
          "wb-hint",
          "在画布上选择一个步骤后，在这里配置它的名称、负责人、输入输出、提示词与运行参数。",
        ),
      );
      return panel;
    }
    const head = el("div", "wb-panel-head");
    head.append(
      el("h2", undefined, `步骤配置 · ${step.title || "未命名步骤"}`),
      button("wb-btn wb-btn-danger", "删除步骤", () => void controller.deleteStep(step.id)),
    );
    panel.append(head);

    const grid = el("div", "wb-step-form-grid");
    const title = el("input");
    title.value = step.title;
    title.addEventListener("input", () => controller.updateStep(step.id, { title: title.value }));
    grid.append(labeled("步骤名称", title, true));

    const pool = candidatePool(state.teamGraph, state.draft.memberIds);
    const owner = el("select");
    for (const entry of pool) {
      const option = el("option", undefined, entry.node.name);
      (option as HTMLOptionElement).value = entry.node.id;
      if (entry.node.id === step.ownerId) option.selected = true;
      owner.append(option);
    }
    owner.addEventListener("change", () => {
      const nextOwner = pool.find((entry) => entry.node.id === owner.value);
      controller.updateStep(step.id, { ownerId: owner.value });
      if (nextOwner)
        controller.updateStepConfig(step.id, {
          model: nextOwner.node.model,
          tokens: Math.min(step.config.tokens, nextOwner.node.tokens),
        });
    });
    grid.append(labeled("负责人", owner));

    const mode = el("select");
    for (const [value, text] of Object.entries(WORKFLOW_STEP_MODE_LABEL)) {
      const option = el("option", undefined, text);
      (option as HTMLOptionElement).value = value;
      if (value === step.mode) option.selected = true;
      mode.append(option);
    }
    mode.addEventListener("change", () =>
      controller.updateStep(step.id, { mode: mode.value as typeof step.mode }),
    );
    grid.append(labeled("执行方式", mode));

    const dependencies = el(
      "div",
      undefined,
      step.dependsOn.length
        ? step.dependsOn.map((id) => controller.stepTitle(id)).join("、")
        : "无（起始步骤）",
    );
    dependencies.style.padding = "12px 0";
    grid.append(labeled("依赖步骤", dependencies));
    panel.append(grid);

    // 输入来源 (story 24): dispatch fields and upstream outputs, toggle to add/remove.
    const inputGrid = el("div", "wb-form-grid");
    const inputSources = el("div");
    inputSources.append(el("div", "wb-field-label", "输入来源（勾选后缺失的须补齐）"));
    const upstream = state.draft.steps.filter(
      (candidate) => candidate.id !== step.id && step.dependsOn.includes(candidate.id),
    );
    for (const field of state.draft.inputFields) {
      inputSources.append(
        renderInputToggle(
          `派发输入 · ${field.label}`,
          () =>
            step.config.inputRefs.some(
              (ref) => ref.kind === "dispatch" && ref.fieldKey === field.key,
            ),
          (on) => {
            const refs = on
              ? [...step.config.inputRefs, { kind: "dispatch" as const, fieldKey: field.key }]
              : step.config.inputRefs.filter(
                  (ref) => !(ref.kind === "dispatch" && ref.fieldKey === field.key),
                );
            controller.updateStepConfig(step.id, { inputRefs: refs });
          },
        ),
      );
    }
    for (const source of upstream) {
      inputSources.append(
        renderInputToggle(
          `步骤输出 · ${source.config.outputLabel || source.title}`,
          () =>
            step.config.inputRefs.some((ref) => ref.kind === "step" && ref.stepId === source.id),
          (on) => {
            const refs = on
              ? [...step.config.inputRefs, { kind: "step" as const, stepId: source.id }]
              : step.config.inputRefs.filter(
                  (ref) => !(ref.kind === "step" && ref.stepId === source.id),
                );
            controller.updateStepConfig(step.id, { inputRefs: refs });
          },
        ),
      );
    }
    inputGrid.append(inputSources);

    const outputs = el("div");
    const outputLabel = el("input");
    outputLabel.value = step.config.outputLabel;
    outputLabel.placeholder = "例如：岗位标准";
    outputLabel.addEventListener("input", () =>
      controller.updateStepConfig(step.id, { outputLabel: outputLabel.value }),
    );
    outputs.append(labeled("输出", outputLabel));
    const outputKey = el("input");
    outputKey.value = step.config.outputKey;
    outputKey.placeholder = "输出标识（必填）";
    outputKey.addEventListener("input", () =>
      controller.updateStepConfig(step.id, { outputKey: outputKey.value }),
    );
    outputs.append(labeled("输出标识", outputKey));
    inputGrid.append(outputs);
    panel.append(inputGrid);

    panel.append(el("h3", "wb-prompt-title", "本步骤提示词"));
    const prompt = el("textarea", "wb-prompt-editor");
    prompt.value = step.config.prompt;
    prompt.placeholder = "根据岗位要求拆解可核对审核标准。";
    prompt.addEventListener("input", () =>
      controller.updateStepConfig(step.id, { prompt: prompt.value }),
    );
    panel.append(prompt);

    const runParams = el("div", "wb-run-params");
    const tools = el("select");
    for (const tool of ["无工具", "读取文件", "读写文件"]) {
      const option = el("option", undefined, tool);
      (option as HTMLOptionElement).value = tool;
      if (tool === step.config.tools) option.selected = true;
      tools.append(option);
    }
    tools.addEventListener("change", () =>
      controller.updateStepConfig(step.id, { tools: tools.value }),
    );
    runParams.append(labeled("工具", tools));

    const tokens = el("input");
    tokens.type = "number";
    tokens.min = "1";
    tokens.value = String(step.config.tokens);
    tokens.addEventListener("change", () =>
      controller.updateStepConfig(step.id, {
        tokens: Math.max(1, Math.floor(Number(tokens.value) || 1)),
      }),
    );
    runParams.append(labeled("Token", tokens));

    const model = el("input");
    model.value = step.config.model;
    model.placeholder = "Claude Sonnet";
    model.addEventListener("change", () =>
      controller.updateStepConfig(step.id, { model: model.value }),
    );
    runParams.append(labeled("模型", model));
    panel.append(runParams);
    return panel;
  }

  function renderInputToggle(
    label: string,
    isOn: () => boolean,
    onChange: (on: boolean) => void,
  ): HTMLElement {
    const row = el("label", "wb-member-chip");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = isOn();
    checkbox.style.width = "16px";
    checkbox.addEventListener("change", () => onChange(checkbox.checked));
    row.style.marginBottom = "8px";
    row.append(checkbox, el("span", "wb-member-name", label));
    return row;
  }

  function renderFooter(state: ReturnType<WorkflowEditorController["getState"]>): HTMLElement {
    const footer = el("div", "wb-footer");
    const statusText = state.lastError
      ? state.lastError
      : state.problems.length
        ? state.problems.map((problem) => problem.message).join(" ")
        : "流程完整，可以确认或直接首次派发。";
    const status = el(
      "p",
      `wb-footer-status${state.problems.length || state.lastError ? " has-problem" : ""}`,
      statusText,
    );
    status.setAttribute("role", "status");
    footer.append(status);
    const actions = el("div", "wb-footer-actions");
    actions.append(
      button("wb-btn wb-btn-ghost", "返回项目详情", () => void controller.leave()),
      button(
        "wb-btn wb-btn-outline",
        state.status === "saving" ? "正在保存…" : "保存草稿",
        () => void controller.saveDraft(),
        state.status !== "idle",
      ),
      button(
        "wb-btn wb-btn-outline",
        state.status === "confirming" ? "正在确认…" : "只确认工作流",
        () => void controller.confirmOnly(),
        state.problems.length > 0 || state.status !== "idle",
      ),
      button(
        "wb-btn wb-btn-accent",
        "继续首次派发",
        () => controller.continueToDispatch(),
        state.problems.length > 0,
      ),
    );
    footer.append(actions);
    return footer;
  }
}
