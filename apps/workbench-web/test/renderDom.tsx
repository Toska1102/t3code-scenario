import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

export async function renderDom(element: ReactNode) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(element));
  } catch (error) {
    await act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    throw error;
  }
  return {
    container,
    async [Symbol.asyncDispose]() {
      await act(() => root.unmount());
      container.remove();
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
}

export async function fillInput(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
