import { msg } from "gt-react";

import { m } from "../../../i18n/messages";

export type ResultPanelTaskStatus =
  | "running"
  | "awaiting-review"
  | "awaiting-rework"
  | "pending"
  | "completed"
  | "failed"
  | "cancelled";

export type ResultPanelFile = {
  readonly materialId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export type WorkbenchDeliveryReceiptLike = {
  readonly deliveryId: string;
  readonly state: "saved" | "pending-delivery";
  readonly summary: string;
  readonly text?: string;
  readonly files: ReadonlyArray<ResultPanelFile>;
  readonly savedAt?: string;
  readonly failureReason?: string;
};

export type ResultPanelInput = {
  readonly taskStatus: ResultPanelTaskStatus;
  /** All executable steps finished and required reviews passed. */
  readonly stepsCompleted?: boolean;
  readonly stageOutputs?: ReadonlyArray<string>;
  readonly receipt?: WorkbenchDeliveryReceiptLike;
  /** Display-level failure reading an already-saved formal result (D11). */
  readonly readError?: string;
};

export type ResultPanelState =
  | {
      readonly kind: "in-progress";
      readonly stageOutputs: ReadonlyArray<string>;
    }
  | {
      readonly kind: "saving-result";
    }
  | {
      readonly kind: "pending-delivery";
      readonly failureReason: string;
      readonly retry: { readonly deliveryId: string; readonly summary: string };
    }
  | {
      readonly kind: "completed";
      readonly statusLabel: string;
      readonly summary: string;
      readonly text?: string | undefined;
      readonly files: ReadonlyArray<ResultPanelFile>;
      readonly readError?: string | undefined;
      readonly retryRead: boolean;
    };

/**
 * Unified result-area view model (spec 04.01 统一结果交付). A03: completion requires a
 * saved formal result. D06/D07: a save failure keeps the task pending with a retry of the
 * same delivery. D11: a read failure only affects display — the completed label stays.
 */
export function deriveResultPanelState(input: ResultPanelInput): ResultPanelState {
  const receipt = input.receipt;
  if (receipt && receipt.state === "pending-delivery") {
    // A completed status can never rest on a pending delivery; keep the retry affordance.
    return {
      kind: "pending-delivery",
      failureReason: receipt.failureReason ?? m(msg("结果保存失败。")),
      retry: { deliveryId: receipt.deliveryId, summary: receipt.summary },
    };
  }
  if (input.taskStatus === "completed" && receipt?.state === "saved") {
    return {
      kind: "completed",
      statusLabel: m(msg("已完成")),
      summary: receipt.summary,
      text: receipt.text,
      files: receipt.files,
      readError: input.readError,
      retryRead: Boolean(input.readError),
    };
  }
  if (input.stepsCompleted) {
    return { kind: "saving-result" };
  }
  return { kind: "in-progress", stageOutputs: input.stageOutputs ?? [] };
}
