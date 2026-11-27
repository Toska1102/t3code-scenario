import { useEffect } from "react";

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const currentUrl = window.location.href;
    let accepted = false;
    function confirmExit() {
      return window.confirm("项目尚未保存，确定放弃修改？");
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    function beforeLink(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.href === currentUrl
      )
        return;
      if (!confirmExit()) {
        event.preventDefault();
        event.stopPropagation();
      } else accepted = true;
    }
    function beforeRoute() {
      if (window.location.href === currentUrl) return;
      if (accepted || confirmExit()) {
        accepted = false;
        return;
      }
      window.history.replaceState(window.history.state, "", currentUrl);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    window.addEventListener("hashchange", beforeRoute);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
      window.removeEventListener("hashchange", beforeRoute);
    };
  }, [dirty]);
}
