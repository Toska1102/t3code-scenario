/** @vitest-environment jsdom */
import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { fillInput, renderDom } from "../../test/renderDom";
import { ProductApp } from "./ProductApp";

describe("product create and recovery flow", () => {
  it("keeps a failed save editable, retries with the same request ID, reads back and survives a remount", async () => {
    window.history.replaceState({}, "", "/workbench#/projects/new");
    const saved = { id: "saved-project", name: "研发运营", teamId: null, workDirectory: null };
    const attempts: unknown[] = [];
    using transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/workbench/teams") return Response.json({ teams: [] });
      if (init?.method === "POST" && path === "/api/workbench/projects") {
        attempts.push(JSON.parse(String(init.body)));
        return attempts.length === 1
          ? Response.json(
              { error: { code: "internal_error", message: "存储暂不可用" } },
              { status: 503 },
            )
          : Response.json(saved, { status: 201 });
      }
      if (path === "/api/workbench/projects/saved-project") return Response.json(saved);
      throw new Error(`Unexpected HTTP request ${path}`);
    });
    {
      await using screen = await renderDom(<ProductApp />);
      await vi.waitFor(() =>
        expect(screen.container.querySelector("h1")?.textContent).toBe("新建项目"),
      );
      await fillInput(
        screen.container.querySelector<HTMLInputElement>('input[name="name"]')!,
        "研发运营",
      );
      await act(() => screen.container.querySelector("form")!.requestSubmit());
      await vi.waitFor(() =>
        expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
          "存储暂不可用",
        ),
      );
      expect(screen.container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe(
        "研发运营",
      );
      await act(() => screen.container.querySelector("form")!.requestSubmit());
      await vi.waitFor(() =>
        expect(screen.container.querySelector("h1")?.textContent).toBe("研发运营"),
      );
      expect(window.location.hash).toBe("#/projects/saved-project");
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      expect(attempts[0]).toMatchObject({ name: "研发运营", teamId: null, workDirectory: null });
    }
    await using refreshed = await renderDom(<ProductApp />);
    await vi.waitFor(() =>
      expect(refreshed.container.querySelector("h1")?.textContent).toBe("研发运营"),
    );
    expect(transport).toHaveBeenCalledWith(
      "/api/workbench/projects/saved-project",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    window.history.replaceState({}, "", "/workbench");
  });

  it("protects an unsaved project when navigating to team home", async () => {
    window.history.replaceState({}, "", "/workbench#/projects/new");
    using transport = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ teams: [] }));
    using confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await using screen = await renderDom(<ProductApp />);
    await vi.waitFor(() => expect(screen.container.querySelector("form")).not.toBeNull());
    await fillInput(
      screen.container.querySelector<HTMLInputElement>('input[name="name"]')!,
      "未保存项目",
    );
    await act(() =>
      screen.container.querySelector<HTMLAnchorElement>('[aria-label="团队首页"]')!.click(),
    );
    expect(confirm).toHaveBeenCalled();
    expect(screen.container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe(
      "未保存项目",
    );
    window.history.replaceState({}, "", "/workbench");
  });
});
