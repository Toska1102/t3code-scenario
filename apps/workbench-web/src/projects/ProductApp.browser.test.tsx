import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { ProductApp } from "./ProductApp";

const team = { id: "team-a", name: "研究团队", description: "真实团队说明" };
const project = { id: "project-a", name: "研究项目", teamId: "team-a", workDirectory: null };

function serveProduct() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input);
    if (path === "/api/workbench/teams") return Response.json({ teams: [team] });
    if (path.startsWith("/api/workbench/projects?")) return Response.json({ projects: [project] });
    if (path === "/api/workbench/projects") return Response.json({ projects: [project] });
    if (path === "/api/workbench/projects/project-a") return Response.json(project);
    if (path === "/api/workbench/summary")
      return Response.json({ teams: 1, projects: 1, tasks: 0 });
    return Response.json(
      { error: { code: "not_found", message: "服务尚未挂载" } },
      { status: 404 },
    );
  });
}

describe("integrated product front door", () => {
  it("opens a live team project list and detail instead of the demo task", async () => {
    using transport = serveProduct();
    await using screen = await render(<ProductApp />);
    await expect.element(screen.getByRole("heading", { name: "团队总览" })).toBeVisible();
    await expect.element(screen.getByText("真实团队说明")).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "查看项目 →" }));
    await expect.element(screen.getByRole("heading", { name: "研究团队的项目" })).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "研究项目" }));
    await expect
      .element(screen.getByRole("heading", { name: "研究项目", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "项目设置" })).toBeVisible();
    expect(transport).not.toHaveBeenCalledWith(
      expect.stringContaining("task-025"),
      expect.anything(),
    );
  });
});
