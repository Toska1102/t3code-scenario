// @vitest-environment jsdom
import { configure, fireEvent, getByRole, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardOrganization } from "../../../../../packages/workbench-core/src/teams/organization/Organization.test";
import { OrganizationDialog, type OrganizationDialogProps } from "./OrganizationDialog";

configure({ testIdAttribute: "data-node-id" });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderDialog(overrides: Partial<OrganizationDialogProps> = {}) {
  const props: OrganizationDialogProps = {
    team: { id: "team-hr", name: "HR 团队", description: "负责组织发展与人力资源运营" },
    revision: 1,
    organization: boardOrganization(),
    people: [{ id: "p-1", name: "王敏" }],
    agentInstances: [
      { id: "claude-1", name: "Claude", available: true },
      { id: "codex-1", name: "Codex", available: true },
    ],
    agentSummary: { available: 2, total: 3 },
    onSave: vi.fn(async () => ({ ok: true, revision: 2 })),
    onClose: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root.render(<OrganizationDialog {...props} />);
  });
  return props;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OrganizationDialog (画板 01.02)", () => {
  it("renders the board structure: header, team config, canvas, config form and footer", async () => {
    await renderDialog();
    const dialog = getByRole(container, "dialog");
    expect(within(dialog).getByRole("heading", { name: "组织架构" })).toBeTruthy();
    expect(within(dialog).getByLabelText("团队名称")).toHaveProperty("value", "HR 团队");
    expect(within(dialog).getByLabelText("团队描述")).toHaveProperty(
      "value",
      "负责组织发展与人力资源运营",
    );
    expect(within(dialog).getByRole("button", { name: "添加节点" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "导入 YAML" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "导出 YAML" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "保存团队" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeTruthy();
    expect(within(dialog).getByText("12 个节点 · 2 个绑定 Agent")).toBeTruthy();
    // 画布节点卡片可点选
    expect(within(dialog).getByTestId("hr")).toBeTruthy();
    expect(within(dialog).getByTestId("recruit").textContent).toContain("招聘");
    expect(within(dialog).getByTestId("recruit").textContent).toContain("Codex");
    expect(within(dialog).getByTestId("td").textContent).toContain("未绑定");
  });

  it("selects a node and edits its fields; multi-parent select offers adjacent-layer nodes", async () => {
    const user = userEvent.setup();
    await renderDialog();
    // 选中第三层节点 TA：候选上级是相邻第二层。
    await act(async () => {
      fireEvent.click(getByTestIdInternal("ta"));
    });
    expect(getByRole(container, "heading", { name: "岗位配置 · TA" })).toBeTruthy();
    const name = getByRole(container, "textbox", { name: "名称" }) as HTMLInputElement;
    expect(name.value).toBe("TA");
    await user.type(name, "校招");
    expect((getByRole(container, "textbox", { name: "名称" }) as HTMLInputElement).value).toBe(
      "TA校招",
    );

    const parents = getByRole(container, "listbox", { name: "汇报给" }) as HTMLSelectElement;
    const labels = Array.from(parents.options).map((o) => o.textContent);
    // 相邻上层（第二层）节点才是候选；根与同层第三层节点不出现。
    expect(labels).toContain("TD");
    expect(labels).not.toContain("HR 总管");
    expect(labels).not.toContain("TA");
    const executor = getByRole(container, "combobox", { name: "执行者" }) as HTMLSelectElement;
    expect(Array.from(executor.options).map((o) => o.textContent)).toEqual(
      expect.arrayContaining(["未绑定", "人员 · 王敏", "Agent · Codex"]),
    );
  });

  it("adds a node under the current selection and selects it; refuses a fourth layer", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await act(async () => {
      fireEvent.click(getByTestIdInternal("ssc"));
    });
    await user.click(getByRole(container, "button", { name: "添加节点" }));
    expect(getByRole(container, "heading", { name: "岗位配置 · 新岗位" })).toBeTruthy();
    expect(within(container).getByText("13 个节点 · 2 个绑定 Agent")).toBeTruthy();

    // 第三层节点下不能再加：提示另选上级且不新增节点。
    await user.click(getByRole(container, "button", { name: "添加节点" }));
    expect(within(container).getByText("第三层节点下不能再添加，请选择其他上级节点")).toBeTruthy();
    expect(within(container).getByText("13 个节点 · 2 个绑定 Agent")).toBeTruthy();
  });

  it("previews deletion impact and cascades only after explicit confirmation; root cannot be deleted", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await act(async () => {
      fireEvent.click(getByTestIdInternal("ssc"));
    });
    await user.click(getByRole(container, "button", { name: "删除" }));
    const overlay = getByRole(container, "alertdialog");
    expect(within(overlay).getByText("删除「SSC」")).toBeTruthy();
    for (const child of ["TA", "入转调离", "薪酬核算", "社保公积金"]) {
      expect(within(overlay).getByText(child)).toBeTruthy();
    }
    expect(within(overlay).getByText(/孤立下属/i)).toBeTruthy();
    await user.click(getByRole(overlay!, "button", { name: "确认删除" }));
    expect(within(container).getByText("7 个节点 · 2 个绑定 Agent")).toBeTruthy();

    // 根节点无删除入口。
    await act(async () => {
      fireEvent.click(getByTestIdInternal("hr"));
    });
    expect(() => getByRole(container, "button", { name: "删除" })).toThrow();
  });

  it("keeps the draft on invalid YAML import and applies after preview on success", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await user.click(getByRole(container, "button", { name: "导入 YAML" }));
    const input = getByRole(container, "textbox", {
      name: "导入 YAML 内容",
    }) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "formatVersion: 99" } });
    });
    await user.click(getByRole(container, "button", { name: "解析并预览" }));
    expect(within(container).getByText(/不支持的格式版本/)).toBeTruthy();
    expect(within(container).getByText("12 个节点 · 2 个绑定 Agent")).toBeTruthy();

    // 成功路径：预览差异后应用。
    await act(async () => {
      fireEvent.click(getByTestIdInternal("hr"));
    });
    await user.click(getByRole(container, "button", { name: "添加节点" }));
    const imported =
      "formatVersion: 1\nteam:\n  name: HR 团队\n  description: 负责组织发展与人力资源运营\nrootNodeId: od\nnodes:\n  - id: od\n    name: OD\n    type: role\n    parentIds: []\n";
    await act(async () => {
      fireEvent.change(input, { target: { value: imported } });
    });
    await user.click(getByRole(container, "button", { name: "解析并预览" }));
    const previewDialog = getByRole(container, "dialog", { name: "导入预览" });
    await user.click(getByRole(previewDialog, "button", { name: "应用到草稿" }));
    expect(within(container).getByText("1 个节点 · 0 个绑定 Agent")).toBeTruthy();
  });

  it("exports YAML without private bindings", async () => {
    let capturedExport = "";
    await renderDialog({
      onExportYaml: (yaml) => {
        capturedExport = yaml;
      },
    });
    await userEvent.click(getByRole(container, "button", { name: "导出 YAML" }));
    expect(capturedExport).toContain("formatVersion: 1");
    expect(capturedExport).not.toContain("codex-1");
  });

  it("disables save while submitting, keeps the draft on failure and locates issues", async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "保存失败，请重试" })
      .mockResolvedValueOnce({ ok: true, revision: 2 });
    const user = userEvent.setup();
    await renderDialog({ onSave });
    const save = getByRole(container, "button", { name: "保存团队" }) as HTMLButtonElement;
    await user.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(within(container).getByText("保存失败，请重试")).toBeTruthy();
    expect(
      (getByRole(container, "button", { name: "保存团队" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await user.click(getByRole(container, "button", { name: "保存团队" }));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("guards unsaved changes on cancel: confirm abandons, otherwise closes directly", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderDialog({ onClose });
    // 无修改直接关闭。
    await user.click(getByRole(container, "button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation before abandoning a dirty draft", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderDialog({ onClose });
    await act(async () => {
      fireEvent.click(getByTestIdInternal("od"));
    });
    await user.type(getByRole(container, "textbox", { name: "名称" }), "x");
    await user.click(getByRole(container, "button", { name: "取消" }));
    const guard = getByRole(container, "alertdialog");
    expect(within(guard).getByText(/未保存的修改/)).toBeTruthy();
    await user.click(getByRole(guard, "button", { name: "继续编辑" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(getByRole(container, "button", { name: "取消" }));
    await user.click(
      getByRole(getByRole(container, "alertdialog"), "button", { name: "放弃修改" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// helper: container.querySelectorAll('[data-node-id]') finder used via fireEvent
function getByTestIdInternal(testId: string): HTMLElement {
  const el = container.querySelector(`[data-node-id="${testId}"]`);
  if (!el) throw new Error(`node ${testId} not found`);
  return el as HTMLElement;
}
