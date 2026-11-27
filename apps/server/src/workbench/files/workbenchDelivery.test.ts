// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  WorkbenchDeliveryAccessError,
  WorkbenchDeliveryReadError,
  WORKBENCH_DELIVERY_DEFAULT_LIMITS,
  createWorkbenchDeliveryService,
} from "./workbenchDelivery.ts";

const ADMIN = { kind: "workbench-admin", userId: "user-1" } as const;
const OUTSIDER = { kind: "unauthenticated" } as const;

function openService() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeFS.realpathSync(NodeOS.tmpdir()), "wb-dlv-"));
  return { root, service: createWorkbenchDeliveryService({ storageRoot: root }) };
}

function saveInput() {
  return {
    taskId: "task-025",
    attemptId: "attempt-1",
    actor: ADMIN,
    summary: "经复核的候选人建议",
    text: "建议进入下一轮：候选人 A、B。",
    files: [
      { materialId: "wbmat-1", name: "建议.pdf", mimeType: "application/pdf", sizeBytes: 128 },
    ],
  };
}

describe("WorkbenchDeliveryService.saveFormalResult", () => {
  it("persists the formal artifact once and returns a saved receipt", () => {
    const { root, service } = openService();
    const { receipt } = service.saveFormalResult(saveInput());
    expect(receipt.state).toBe("saved");
    expect(receipt.deliveryId).toMatch(/^wbdlv-/);
    expect(receipt.savedAt).toBeTruthy();
    const stored = NodeFS.readdirSync(NodePath.join(root, "deliveries", "task-025"));
    expect(stored).toEqual([`${receipt.deliveryId}.json`]);
    const artifact = JSON.parse(NodeFS.readFileSync(storedPath(root, receipt), "utf8")) as {
      summary: string;
      text: string;
      files: unknown[];
    };
    expect(artifact.summary).toBe("经复核的候选人建议");
    expect(artifact.text).toContain("候选人 A");
    expect(artifact.files).toHaveLength(1);
  });

  it("is idempotent per submission key: retrying the same save returns the same receipt without rewriting", () => {
    const { root, service } = openService();
    const first = service.saveFormalResult(saveInput()).receipt;
    const second = service.saveFormalResult(saveInput()).receipt;
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(second.savedAt).toBe(first.savedAt);
    expect(NodeFS.readdirSync(NodePath.join(root, "deliveries", "task-025"))).toHaveLength(1);
  });

  it("different attempts of the same task produce different deliveries", () => {
    const { service } = openService();
    const a = service.saveFormalResult(saveInput()).receipt;
    const b = service.saveFormalResult({ ...saveInput(), attemptId: "attempt-2" }).receipt;
    expect(b.deliveryId).not.toBe(a.deliveryId);
  });

  it("on artifact write failure the receipt stays pending-delivery and commit is not invoked", () => {
    let commits = 0;
    const service = createWorkbenchDeliveryService({
      storageRoot: NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wb-dlv-")),
      sink: {
        writeOnce: () => {
          throw new Error("disk full");
        },
        readOrFail: () => {
          throw new Error("disk full");
        },
      },
    });
    const { receipt, committed } = service.saveFormalResult({
      ...saveInput(),
      commit: () => {
        commits += 1;
      },
    });
    expect(receipt.state).toBe("pending-delivery");
    expect(receipt.failureReason).toContain("disk full");
    expect(committed).toBe(false);
    expect(commits).toBe(0);
    expect(service.canMarkCompleted(receipt)).toBe(false);
  });

  it("retry after failure saves the same generated result without re-executing steps", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wb-dlv-"));
    let failing = true;
    const service = createWorkbenchDeliveryService({
      storageRoot: root,
      sink: {
        writeOnce: (path, content) => {
          if (failing) throw new Error("disk full");
          NodeFS.writeFileSync(path, content, { flag: "wx" });
        },
        readOrFail: (path) => NodeFS.readFileSync(path, "utf8"),
      },
    });
    const pending = service.saveFormalResult(saveInput()).receipt;
    failing = false;
    const retried = service.saveFormalResult(saveInput());
    expect(retried.receipt.deliveryId).toBe(pending.deliveryId);
    expect(retried.receipt.state).toBe("saved");
    expect(retried.committed).toBe(true);
    expect(service.canMarkCompleted(retried.receipt)).toBe(true);
  });

  it("commit failure surfaces as uncommitted while the receipt stays saved; retry re-commits", () => {
    let commits = 0;
    const { service } = openService();
    const first = service.saveFormalResult({
      ...saveInput(),
      commit: () => {
        commits += 1;
        if (commits === 1) throw new Error("task store busy");
      },
    });
    expect(first.receipt.state).toBe("saved");
    expect(first.committed).toBe(false);
    const second = service.saveFormalResult({
      ...saveInput(),
      commit: () => {
        commits += 1;
      },
    });
    expect(second.receipt.deliveryId).toBe(first.receipt.deliveryId);
    expect(second.committed).toBe(true);
    expect(commits).toBe(2);
  });
});

describe("WorkbenchDeliveryService.readFormalResult", () => {
  it("returns the receipt and artifact for authorized admins", () => {
    const { service } = openService();
    service.saveFormalResult(saveInput());
    const read = service.readFormalResult({ taskId: "task-025", actor: ADMIN });
    expect(read.receipt.state).toBe("saved");
    expect((JSON.parse(read.artifactJson) as { summary: string }).summary).toBe(
      "经复核的候选人建议",
    );
  });

  it("rejects unauthenticated actors", () => {
    const { service } = openService();
    service.saveFormalResult(saveInput());
    expect(() => service.readFormalResult({ taskId: "task-025", actor: OUTSIDER })).toThrow(
      WorkbenchDeliveryAccessError,
    );
  });

  it("a read failure only affects display: the saved receipt and completion stay intact", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wb-dlv-"));
    let failing = false;
    const service = createWorkbenchDeliveryService({
      storageRoot: root,
      sink: {
        writeOnce: (path, content) => NodeFS.writeFileSync(path, content, { flag: "wx" }),
        readOrFail: () => {
          if (failing) throw new Error("storage unavailable");
          return NodeFS.readFileSync(artifactPath0(root), "utf8");
        },
      },
    });
    const { receipt } = service.saveFormalResult(saveInput());
    failing = true;
    expect(() => service.readFormalResult({ taskId: "task-025", actor: ADMIN })).toThrow(
      WorkbenchDeliveryReadError,
    );
    // Completion ownership (ticket 05) reads the receipt: still saved, still completable.
    expect(service.getReceipt("task-025")?.state).toBe("saved");
    expect(service.canMarkCompleted(receipt)).toBe(true);
    failing = false;
    expect(service.readFormalResult({ taskId: "task-025", actor: ADMIN }).receipt.savedAt).toBe(
      receipt.savedAt,
    );
  });

  it("only lists store-generated delivery ids", () => {
    const { root, service } = openService();
    service.saveFormalResult(saveInput());
    NodeFS.writeFileSync(NodePath.join(root, "deliveries", "task-025", "junk.json"), "{}");
    expect(service.listDeliveryIds("task-025", ADMIN)).toHaveLength(1);
  });
});

describe("limits", () => {
  it("enforce a maximum size on the formal result text", () => {
    const { service } = openService();
    expect(() =>
      service.saveFormalResult({
        ...saveInput(),
        text: "x".repeat(WORKBENCH_DELIVERY_DEFAULT_LIMITS.maxTextChars + 1),
      }),
    ).toThrow();
  });
});

function storedPath(root: string, receipt: { deliveryId: string }): string {
  return NodePath.join(root, "deliveries", "task-025", `${receipt.deliveryId}.json`);
}

function artifactPath0(root: string): string {
  const dir = NodePath.join(root, "deliveries", "task-025");
  return NodePath.join(dir, NodeFS.readdirSync(dir)[0] ?? "");
}
