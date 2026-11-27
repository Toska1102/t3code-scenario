import { useId, useSyncExternalStore } from "react";

import { T, useGT } from "gt-react";

import {
  createMaterialsDraftController,
  type MaterialsDraftController,
  type MaterialsDraftItem,
} from "./materialsDraftController.ts";

const STATUS_CLASSES: Record<MaterialsDraftItem["status"], string> = {
  ready: "text-muted-foreground",
  uploading: "text-warning",
  uploaded: "text-success",
  error: "text-destructive",
};

// gt() requires a literal string so the catalog scanner can key each label.
function statusLabel(gt: (s: string) => string, status: MaterialsDraftItem["status"]): string {
  switch (status) {
    case "ready":
      return gt("待上传");
    case "uploading":
      return gt("上传中");
    case "uploaded":
      return gt("已附上");
    case "error":
      return gt("失败");
  }
}

export function MaterialsPanel(props: {
  readonly controller: MaterialsDraftController;
  readonly label?: string;
  readonly emptyText?: string;
  readonly onRemoveUploaded?: (materialId: string) => void;
  readonly onUpload?: (item: MaterialsDraftItem) => Promise<{ materialId: string }>;
  readonly disabled?: boolean;
}) {
  const gt = useGT();
  const state = useSyncExternalStore(
    props.controller.subscribe.bind(props.controller),
    props.controller.getState.bind(props.controller),
  );
  const inputId = useId();
  const errorId = useId();
  const label = props.label ?? gt("添加附件");
  const emptyText = props.emptyText ?? gt("尚未选择文件");

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          disabled={props.disabled}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            props.controller.addFiles(files);
            if (!props.onUpload) return;
            void props.controller.upload(props.onUpload);
          }}
        />
        <button
          type="button"
          className="text-foreground/75 text-xs hover:text-foreground"
          disabled={props.disabled}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          <T>选择文件</T>
        </button>
      </div>

      <div role="status" aria-live="polite" id={errorId}>
        {state.lastError ? <p className="text-destructive text-xs">{state.lastError}</p> : null}
      </div>

      {state.items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {state.items.map((item) => (
            <li
              key={item.localId}
              className="flex min-w-0 items-center gap-2 text-xs"
              aria-describedby={item.error ? errorId : undefined}
            >
              <span className="min-w-0 truncate">{item.name}</span>
              <span className={STATUS_CLASSES[item.status]}>{statusLabel(gt, item.status)}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                disabled={props.disabled}
                aria-label={gt("移除 {name}", { name: item.name })}
                onClick={() => {
                  if (item.materialId && props.onRemoveUploaded) {
                    props.onRemoveUploaded(item.materialId);
                  }
                  props.controller.remove(item.localId);
                }}
              >
                <T>移除</T>
              </button>
              <label className="sr-only" htmlFor={`${inputId}-replace-${item.localId}`}>
                {gt("替换 {name}", { name: item.name })}
              </label>
              <input
                id={`${inputId}-replace-${item.localId}`}
                type="file"
                className="sr-only"
                disabled={props.disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  props.controller.replace(item.localId, file);
                  if (!props.onUpload) return;
                  void props.controller.upload(props.onUpload);
                }}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                disabled={props.disabled}
                aria-label={gt("替换 {name}", { name: item.name })}
                onClick={() =>
                  document.getElementById(`${inputId}-replace-${item.localId}`)?.click()
                }
              >
                <T>替换</T>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function createWorkbenchMaterialsPanel() {
  return createMaterialsDraftController();
}
