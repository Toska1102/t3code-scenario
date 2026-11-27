import { workflowEditorCss } from "./designTokens.ts";
import {
  CreateWorkflowPanelController,
  type CreateWorkflowPanelOperations,
} from "./CreateWorkflowPanelController.ts";

export interface CreateWorkflowPanelMountOptions {
  container: HTMLElement;
  operations: CreateWorkflowPanelOperations;
  /** Called with the freshly created draft; the host opens the 03.01 editor with it. */
  onCreated(
    draft: import("../../../../packages/workbench-contracts/src/workflow/types.ts").WorkflowDraft,
  ): void;
}

export interface CreateWorkflowPanelHandle {
  controller: CreateWorkflowPanelController;
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

/**
 * 02.01 新建任务工作流 module (story 17): describe the work, attach 本次材料,
 * create a draft. Framework-free; mounts into any container.
 */
export function mountCreateWorkflowPanel(
  options: CreateWorkflowPanelMountOptions,
): CreateWorkflowPanelHandle {
  injectStyle();
  const { container } = options;
  const controller = new CreateWorkflowPanelController(options.operations, {
    onCreated: options.onCreated,
  });

  let destroyed = false;
  const render = (): void => {
    if (destroyed) return;
    container.replaceChildren(renderPanel());
  };
  const unsubscribe = controller.subscribe(render);
  render();

  return {
    controller,
    destroy() {
      destroyed = true;
      unsubscribe();
      container.replaceChildren();
    },
  };

  function renderPanel(): HTMLElement {
    const state = controller.getState();
    const root = el("div", "wb-workflow-editor");
    const page = el("div", "wb-page");
    const panel = el("div", "wb-describe-panel");
    panel.append(el("h2", undefined, "新建任务工作流"));
    const helper = el(
      "div",
      "wb-subtitle",
      "项目助手 · 用一段话描述这件事通常怎么做，并附上本次材料。",
    );
    panel.append(helper);

    const textarea = el("textarea");
    textarea.rows = 4;
    textarea.placeholder =
      "我想审核一批研发岗简历。请整理每份简历和岗位要求的匹配依据，再由 HR 总管复核。";
    textarea.value = state.description;
    textarea.addEventListener("input", () => controller.setDescription(textarea.value));
    panel.append(textarea);

    const materials = el("div", "wb-materials");
    materials.append(el("div", "wb-io-label", controller.caption()));
    for (const material of state.materials) {
      const row = el("div", "wb-history-row");
      row.append(el("span", "wb-history-name", material.fileName));
      const error = controller.fileError(material.id);
      if (error) row.append(el("span", "wb-field-error", error));
      row.append(button("wb-btn wb-btn-ghost", "移除", () => controller.removeFile(material.id)));
      materials.append(row);
    }
    const picker = el("input");
    picker.type = "file";
    picker.multiple = true;
    picker.style.display = "none";
    picker.addEventListener("change", () => {
      for (const file of picker.files ?? []) controller.addFile(file.name);
      picker.value = "";
    });
    const attach = button("wb-btn wb-btn-outline", "添加附件", () => picker.click());
    materials.append(attach, picker);
    panel.append(materials);

    if (state.lastError) panel.append(el("div", "wb-field-error", state.lastError));
    panel.append(
      button(
        "wb-btn wb-btn-primary",
        state.submitting ? "创建中…" : "创建工作流草稿",
        () => void controller.submit(),
        state.submitting,
      ),
    );
    page.append(panel);
    root.append(page);
    return root;
  }
}
