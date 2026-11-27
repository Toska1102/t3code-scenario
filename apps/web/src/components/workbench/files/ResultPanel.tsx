import { T, useGT, Var } from "gt-react";

import { deriveResultPanelState, type ResultPanelInput } from "./resultPanel.ts";

/**
 * Unified result area (spec 04.01, stories 39–40): summary, formal deliverables with
 * open/download, retry-save on delivery failure, retry-read on read failure. Mount seam
 * for ticket 09: render beside the task detail panes; ticket 05 supplies task status.
 */
export function ResultPanel(props: {
  readonly input: ResultPanelInput;
  readonly onOpenFile?: (materialId: string) => void;
  readonly onDownloadFile?: (materialId: string) => void;
  readonly onRetrySave?: (deliveryId: string, summary: string) => void;
  readonly onRetryRead?: () => void;
}) {
  const gt = useGT();
  const state = deriveResultPanelState(props.input);

  if (state.kind === "in-progress") {
    return (
      <section aria-label={gt("结果")} className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">
          <T>运行中：尚未取得正式结果。</T>
        </p>
        {state.stageOutputs.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {state.stageOutputs.map((output) => (
              <li key={output}>{output}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  if (state.kind === "saving-result") {
    return (
      <section aria-label={gt("结果")}>
        <p role="status" aria-live="polite" className="text-muted-foreground text-xs">
          <T>正在保存结果…</T>
        </p>
      </section>
    );
  }

  if (state.kind === "pending-delivery") {
    return (
      <section aria-label={gt("结果")} className="flex flex-col gap-2">
        <p role="alert" className="text-destructive text-xs">
          <T>
            结果保存失败：<Var>{state.failureReason}</Var>{" "}
            任务保持待处理，已完成的执行与评审已保留。
          </T>
        </p>
        <button
          type="button"
          className="text-foreground/75 text-xs hover:text-foreground"
          onClick={() => props.onRetrySave?.(state.retry.deliveryId, state.retry.summary)}
        >
          <T>重试保存结果</T>
        </button>
      </section>
    );
  }

  return (
    <section aria-label={gt("结果")} className="flex flex-col gap-2">
      <p aria-live="polite" className="text-muted-foreground text-xs">
        {state.statusLabel}
      </p>
      <h3 className="text-sm font-medium">{state.summary}</h3>
      {state.text ? (
        <div className="text-foreground/75 text-xs">
          <p>{state.text}</p>
        </div>
      ) : null}
      {state.files.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {state.files.map((file) => (
            <li key={file.materialId} className="flex min-w-0 items-center gap-2 text-xs">
              <span className="min-w-0 truncate">{file.name}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => props.onOpenFile?.(file.materialId)}
              >
                <T>打开</T>
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => props.onDownloadFile?.(file.materialId)}
              >
                <T>下载</T>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {state.readError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-destructive text-xs">
            <T>
              读取结果失败：<Var>{state.readError}</Var> 已完成状态保持不变。
            </T>
          </p>
          {state.retryRead ? (
            <button
              type="button"
              className="text-foreground/75 text-xs hover:text-foreground"
              onClick={() => props.onRetryRead?.()}
            >
              <T>重试读取</T>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
