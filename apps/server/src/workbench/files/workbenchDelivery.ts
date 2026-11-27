// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off globalDate:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * Formal delivery for the unified result area (spec 04.01 统一结果交付, stories 39–40).
 * A03: completion requires a saved formal result. D06: a save failure keeps the task
 * pending delivery. D07: retry saves the already-generated result — completed steps and
 * approvals are reused. D11: a read failure only affects display.
 */

export const WORKBENCH_DELIVERY_DEFAULT_LIMITS = {
  maxTextChars: 200_000,
  maxSummaryChars: 2_000,
  maxFiles: 20,
} as const;

export type WorkbenchDeliveryLimits = {
  readonly maxTextChars: number;
  readonly maxSummaryChars: number;
  readonly maxFiles: number;
};

export type WorkbenchDeliveryActor =
  | { readonly kind: "workbench-admin"; readonly userId: string }
  | { readonly kind: "unauthenticated" };

export type WorkbenchDeliveryFile = {
  readonly materialId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export type WorkbenchDeliveryReceipt = {
  readonly deliveryId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly state: "saved" | "pending-delivery";
  readonly summary: string;
  readonly text?: string;
  readonly files: ReadonlyArray<WorkbenchDeliveryFile>;
  readonly savedAt?: string;
  readonly failureReason?: string;
};

export type SaveFormalResultInput = {
  readonly taskId: string;
  readonly attemptId: string;
  readonly actor: WorkbenchDeliveryActor;
  readonly summary: string;
  readonly text?: string;
  readonly files: ReadonlyArray<WorkbenchDeliveryFile>;
  /**
   * Commit seam for the task-state owner (ticket 05): invoked after the formal artifact is
   * persisted so the completion mark commits with the delivery. Retrying a committed delivery
   * re-invokes this once; the callback must be idempotent.
   */
  readonly commit?: (receipt: WorkbenchDeliveryReceipt) => void;
};

export type SaveFormalResultOutcome = {
  readonly receipt: WorkbenchDeliveryReceipt;
  /** Whether the caller's commit seam ran without error for this attempt. */
  readonly committed: boolean;
  readonly commitError?: string;
};

export class WorkbenchDeliveryValidationError extends Error {}

export class WorkbenchDeliveryAccessError extends Error {}

export class WorkbenchDeliveryReadError extends Error {}

const DELIVERY_ID_PREFIX = "wbdlv-";
const DELIVERY_ID_PATTERN = /^wbdlv-[0-9a-f]{32}$/;

export type WorkbenchDeliverySink = {
  readonly writeOnce: (absolutePath: string, content: string) => void;
  readonly readOrFail: (absolutePath: string) => string;
};

function localDiskSink(): WorkbenchDeliverySink {
  return {
    writeOnce: (absolutePath, content) => {
      NodeFS.mkdirSync(NodePath.dirname(absolutePath), { recursive: true });
      const tempPath = `${absolutePath}.${NodeCrypto.randomUUID()}.part`;
      const handle = NodeFS.openSync(tempPath, "wx");
      try {
        NodeFS.writeFileSync(handle, content);
      } finally {
        NodeFS.closeSync(handle);
      }
      try {
        NodeFS.linkSync(tempPath, absolutePath);
      } catch {
        throw new WorkbenchDeliveryReadError("正式结果已存在，禁止覆盖。");
      } finally {
        NodeFS.rmSync(tempPath, { force: true });
      }
    },
    readOrFail: (absolutePath) => NodeFS.readFileSync(absolutePath, "utf8"),
  };
}

/** Deterministic per (taskId, attemptId): one submission key maps to one formal delivery. */
export function workbenchDeliveryId(taskId: string, attemptId: string): string {
  const digest = NodeCrypto.createHash("sha256")
    .update(JSON.stringify(["workbench-delivery-v1", taskId, attemptId]))
    .digest("hex")
    .slice(0, 32);
  return `${DELIVERY_ID_PREFIX}${digest}`;
}

export function canMarkCompleted(receipt: WorkbenchDeliveryReceipt): boolean {
  // A03/D06: the task may only complete once the formal result is saved.
  return receipt.state === "saved";
}

export function createWorkbenchDeliveryService(input: {
  readonly storageRoot: string;
  readonly limits?: Partial<WorkbenchDeliveryLimits>;
  readonly sink?: WorkbenchDeliverySink;
  readonly now?: () => Date;
}) {
  const limits: WorkbenchDeliveryLimits = { ...WORKBENCH_DELIVERY_DEFAULT_LIMITS, ...input.limits };
  const root = NodePath.resolve(input.storageRoot);
  const sink = input.sink ?? localDiskSink();
  const now = input.now ?? (() => new Date());
  const receipts = new Map<string, WorkbenchDeliveryReceipt>();

  function requireAdmin(actor: WorkbenchDeliveryActor): void {
    // First workbench version: every authenticated user is an admin (spec §1 通用交互约定).
    if (actor.kind !== "workbench-admin") {
      throw new WorkbenchDeliveryAccessError("未授权：需要工作台管理员身份。");
    }
  }

  function validate(input: SaveFormalResultInput): void {
    const summary = input.summary.trim();
    if (summary.length === 0) {
      throw new WorkbenchDeliveryValidationError("结果摘要不能为空。");
    }
    if (summary.length > limits.maxSummaryChars) {
      throw new WorkbenchDeliveryValidationError("结果摘要超过长度上限。");
    }
    if ((input.text?.length ?? 0) > limits.maxTextChars) {
      throw new WorkbenchDeliveryValidationError("结果正文超过长度上限。");
    }
    if (input.files.length > limits.maxFiles) {
      throw new WorkbenchDeliveryValidationError("交付文件数量超过上限。");
    }
    for (const file of input.files) {
      if (!file.materialId.startsWith("wbmat-")) {
        throw new WorkbenchDeliveryValidationError("交付文件必须是工作台材料。");
      }
    }
    // The taskId forms one on-disk path segment, so it must be a safe id.
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.taskId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.attemptId)
    ) {
      throw new WorkbenchDeliveryValidationError("非法的任务或尝试标识。");
    }
  }

  function artifactPath(taskId: string, deliveryId: string): string {
    const directory = NodePath.resolve(root, "deliveries", taskId);
    const filePath = NodePath.resolve(directory, `${deliveryId}.json`);
    if (!filePath.startsWith(`${directory}${NodePath.sep}`)) {
      throw new WorkbenchDeliveryAccessError("非法的交付路径。");
    }
    return filePath;
  }

  function artifactJson(receipt: WorkbenchDeliveryReceipt): string {
    return JSON.stringify({
      deliveryId: receipt.deliveryId,
      taskId: receipt.taskId,
      attemptId: receipt.attemptId,
      summary: receipt.summary,
      text: receipt.text ?? null,
      files: receipt.files,
    });
  }

  return {
    limits,

    saveFormalResult(input: SaveFormalResultInput): SaveFormalResultOutcome {
      requireAdmin(input.actor);
      const deliveryId = workbenchDeliveryId(input.taskId, input.attemptId);
      const existing = receipts.get(deliveryId);
      if (existing?.state === "saved") {
        // D07: retry only re-saves the generated result; never rewrite, never re-execute.
        if (input.commit) {
          try {
            input.commit(existing);
            return { receipt: existing, committed: true };
          } catch (error) {
            return {
              receipt: existing,
              committed: false,
              commitError: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return { receipt: existing, committed: true };
      }
      validate(input);
      const base = {
        deliveryId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        summary: input.summary.trim(),
        files: input.files,
        ...(input.text === undefined ? {} : { text: input.text }),
      };
      let receipt: WorkbenchDeliveryReceipt;
      try {
        const target = artifactPath(input.taskId, deliveryId);
        NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
        sink.writeOnce(target, artifactJson({ ...base, state: "saved" }));
        receipt = { ...base, state: "saved", savedAt: now().toISOString() };
      } catch (error) {
        // D06: keep the task pending delivery; the staged result is preserved for retry.
        receipt = {
          ...base,
          state: "pending-delivery",
          failureReason: error instanceof Error ? error.message : String(error),
        };
        receipts.set(deliveryId, receipt);
        return { receipt, committed: false };
      }
      receipts.set(deliveryId, receipt);
      if (input.commit) {
        try {
          input.commit(receipt);
        } catch (error) {
          return {
            receipt,
            committed: false,
            commitError: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return { receipt, committed: true };
    },

    getReceipt(taskId: string): WorkbenchDeliveryReceipt | undefined {
      for (const receipt of receipts.values()) {
        if (receipt.taskId === taskId) return receipt;
      }
      return undefined;
    },

    canMarkCompleted,

    readFormalResult(input: { readonly taskId: string; readonly actor: WorkbenchDeliveryActor }): {
      readonly receipt: WorkbenchDeliveryReceipt;
      readonly artifactJson: string;
    } {
      requireAdmin(input.actor);
      const receipt = this.getReceipt(input.taskId);
      if (!receipt || receipt.state !== "saved") {
        throw new WorkbenchDeliveryReadError("尚未取得正式结果。");
      }
      let artifactJson: string;
      try {
        artifactJson = sink.readOrFail(artifactPath(receipt.taskId, receipt.deliveryId));
      } catch (error) {
        // D11: display-only failure; the receipt and completion ownership stay untouched.
        throw new WorkbenchDeliveryReadError(
          error instanceof Error ? error.message : String(error),
        );
      }
      return { receipt, artifactJson };
    },

    listDeliveryIds(taskId: string, actor: WorkbenchDeliveryActor): ReadonlyArray<string> {
      requireAdmin(actor);
      const ids: string[] = [];
      for (const receipt of receipts.values()) {
        if (receipt.taskId === taskId && DELIVERY_ID_PATTERN.test(receipt.deliveryId)) {
          ids.push(receipt.deliveryId);
        }
      }
      return ids;
    },
  };
}

export type WorkbenchDeliveryService = ReturnType<typeof createWorkbenchDeliveryService>;
