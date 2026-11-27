import { msg } from "gt-react";

import {
  WORKBENCH_MATERIAL_DEFAULT_LIMITS,
  materialExtension,
  validateWorkbenchMaterialName,
  type WorkbenchMaterialLimits,
} from "@t3tools/shared/workbenchMaterialsShared";

import { m } from "../../../i18n/messages";

export type MaterialsDraftItem = {
  readonly localId: string;
  readonly file: File;
  readonly name: string;
  readonly status: "ready" | "uploading" | "uploaded" | "error";
  readonly error?: string | undefined;
  readonly materialId?: string | undefined;
  /** Set when this item replaces an earlier uploaded one; the old material drops on success. */
  readonly replaces?: string | undefined;
};

export type MaterialsDraftState = {
  readonly items: ReadonlyArray<MaterialsDraftItem>;
  /** The in-memory draft survives failures until the user discards it (spec: 失败保留草稿). */
  readonly draftRetained: boolean;
  readonly lastError?: string | undefined;
};

export type MaterialsDraftUpload = (item: MaterialsDraftItem) => Promise<{ materialId: string }>;

export type ReplaceWorkbenchMaterial = (input: {
  readonly previousMaterialId: string;
  readonly stagedMaterialId: string;
}) => void;

let localIdCounter = 0;

export function createMaterialsDraftController(input?: {
  readonly limits?: Partial<WorkbenchMaterialLimits>;
  /** Wire a real replace (server call) in production; tests use it to observe ordering. */
  readonly replaceMaterial?: ReplaceWorkbenchMaterial;
}) {
  const limits: WorkbenchMaterialLimits = {
    ...WORKBENCH_MATERIAL_DEFAULT_LIMITS,
    ...input?.limits,
  };
  let items: MaterialsDraftItem[] = [];
  let lastError: string | undefined;
  const listeners = new Set<() => void>();

  function setState(next: { items: MaterialsDraftItem[]; lastError?: string | undefined }): void {
    items = next.items;
    lastError = next.lastError;
    for (const listener of listeners) listener();
  }

  function validateFile(file: File): string {
    try {
      validateWorkbenchMaterialName(file.name, limits);
    } catch (error) {
      return error instanceof Error ? error.message : m(msg("文件名不合法。"));
    }
    if (materialExtension(file.name, limits) === null) {
      return m(msg("不支持的文件类型。"));
    }
    if (file.size === 0) {
      return m(msg("文件内容不能为空。"));
    }
    if (file.size > limits.maxMaterialBytes) {
      return m(
        msg("文件不能超过 {maxMiB} MiB。", {
          maxMiB: Math.floor(limits.maxMaterialBytes / (1024 * 1024)),
        }),
      );
    }
    return "";
  }

  return {
    limits,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getState(): MaterialsDraftState {
      return { items, draftRetained: true, lastError };
    },

    addFiles(files: ReadonlyArray<File>): void {
      const staged: MaterialsDraftItem[] = files.map((file) => {
        const error = validateFile(file);
        localIdCounter += 1;
        return {
          localId: `wblocal-${localIdCounter}`,
          file,
          name: file.name.trim(),
          status: (error ? "error" : "ready") as MaterialsDraftItem["status"],
          error: error || undefined,
        };
      });
      const failed = staged.find((item) => item.status === "error");
      setState({
        items: [...items, ...staged],
        // Valid files stay even when a sibling fails (spec: 失败标明文件并保留其他输入).
        lastError: failed?.error,
      });
    },

    remove(localId: string): void {
      setState({ items: items.filter((item) => item.localId !== localId) });
    },

    replace(localId: string, file: File): void {
      const previous = items.find((item) => item.localId === localId);
      if (!previous) return;
      const error = validateFile(file);
      if (error) {
        // The old material stays; the invalid replacement is reported without discarding the draft.
        setState({ items, lastError: error });
        return;
      }
      localIdCounter += 1;
      const replacement: MaterialsDraftItem = {
        localId: `wblocal-${localIdCounter}`,
        file,
        name: file.name.trim(),
        status: "ready",
        // Only drop the old material once this replacement uploads successfully.
        replaces: previous.status === "uploaded" ? previous.localId : undefined,
      };
      setState({ items: [...items, replacement] });
    },

    /**
     * Upload every ready item. A failed item keeps its original File and error; siblings
     * are untouched. Replacements retire the previous material only after success.
     */
    async upload(uploadItem: MaterialsDraftUpload): Promise<void> {
      let error: string | undefined = lastError;
      for (const item of items) {
        if (item.status !== "ready") continue;
        setState({
          items: items.map((candidate) =>
            candidate.localId === item.localId
              ? ({ ...candidate, status: "uploading" } as MaterialsDraftItem)
              : candidate,
          ),
        });
        try {
          const { materialId } = await uploadItem(item);
          let next: MaterialsDraftItem[] = items.map((candidate) =>
            candidate.localId === item.localId
              ? { ...candidate, status: "uploaded" as const, materialId, error: undefined }
              : candidate,
          );
          if (item.replaces) {
            const previous = next.find((candidate) => candidate.localId === item.replaces);
            if (previous?.materialId && input?.replaceMaterial) {
              input.replaceMaterial({
                previousMaterialId: previous.materialId,
                stagedMaterialId: materialId,
              });
            }
            next = next.filter((candidate) => candidate.localId !== item.replaces);
          }
          setState({ items: next });
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
          setState({
            // The in-memory draft and the original File are kept on failure.
            items: items.map((candidate) =>
              candidate.localId === item.localId
                ? ({ ...candidate, status: "error", error } as MaterialsDraftItem)
                : candidate,
            ),
            lastError: error,
          });
        }
      }
    },
  };
}

export type MaterialsDraftController = ReturnType<typeof createMaterialsDraftController>;
