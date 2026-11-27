import { act as reactAct, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { utils, page, type Locator, type LocatorSelectors } from "vite-plus/test/browser";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

export async function act<T>(callback: () => T | Promise<T>): Promise<T> {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    return await reactAct(async () => await callback());
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

export interface Screen extends LocatorSelectors, AsyncDisposable {
  readonly container: HTMLElement;
  readonly locator: Locator;
  readonly unmount: () => Promise<void>;
}

/** Renders `ui` for one browser test; acquire with `await using`. */
export async function render(ui: ReactNode): Promise<Screen> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(() => root.unmount());
  };
  const screen: Screen = {
    ...utils.getElementLocatorSelectors(container),
    container,
    locator: page.elementLocator(container),
    unmount,
    async [Symbol.asyncDispose]() {
      try {
        await unmount();
      } finally {
        container.remove();
      }
    },
  };

  try {
    await act(() => root.render(ui));
  } catch (error) {
    await screen[Symbol.asyncDispose]();
    throw error;
  }
  return screen;
}
