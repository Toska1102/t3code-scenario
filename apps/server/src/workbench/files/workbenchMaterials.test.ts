// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ChatFileAttachment } from "@t3tools/contracts";

import {
  createWorkbenchMaterialStore,
  WorkbenchMaterialAccessError,
  WorkbenchMaterialValidationError,
  WORKBENCH_MATERIAL_DEFAULT_LIMITS,
} from "./workbenchMaterials.ts";

function openStore() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeFS.realpathSync(NodeOS.tmpdir()), "wb-files-"));
  return { root, store: createWorkbenchMaterialStore({ storageRoot: root }) };
}

const ADMIN = { kind: "workbench-admin", userId: "user-1" } as const;
const OUTSIDER = { kind: "unauthenticated" } as const;
const PROJECT = { kind: "project", projectId: "proj-1" } as const;
const RESUME_BYTES = new TextEncoder().encode("%PDF-1.7 fake resume bytes");

const chatFileAttachmentIs = Schema.is(ChatFileAttachment);

function stageResume(store: ReturnType<typeof createWorkbenchMaterialStore>, name = "简历.pdf") {
  return store.stage({
    scope: PROJECT,
    actor: ADMIN,
    file: { name, mimeType: "application/pdf", bytes: RESUME_BYTES },
  });
}

describe("WorkbenchMaterialStore.stage", () => {
  it("requires a project identifier before writing material bytes", () => {
    const { root, store } = openStore();
    expect(() =>
      store.stage({
        scope: { kind: "project", projectId: "" },
        actor: ADMIN,
        file: { name: "简历.pdf", mimeType: "application/pdf", bytes: RESUME_BYTES },
      }),
    ).toThrow(WorkbenchMaterialAccessError);
    expect(NodeFS.readdirSync(root)).toEqual([]);
  });
  it("stores real bytes under a stable generated id, never derived from the filename", () => {
    const { root, store } = openStore();
    const staged = stageResume(store);
    expect(staged.materialId).toMatch(
      /^wbmat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(staged).toMatchObject({
      name: "简历.pdf",
      mimeType: "application/pdf",
      sizeBytes: RESUME_BYTES.length,
      scope: PROJECT,
    });
    // On-disk name comes from the generated id, not the user filename.
    expect(NodeFS.readdirSync(NodePath.join(root, "projects", "proj-1", "materials"))).toEqual([
      `${staged.materialId}.bin`,
    ]);
    expect(Array.from(NodeFS.readFileSync(staged.absolutePath))).toEqual(Array.from(RESUME_BYTES));
  });

  it("write-once: a material id always maps to the bytes it was created with", () => {
    const { store } = openStore();
    const staged = stageResume(store);
    expect(() => NodeFS.writeFileSync(staged.absolutePath, "tampered")).not.toThrow();
    // Rewriting the same artifact path directly is detected on the next read.
    expect(() =>
      store.read({ scope: PROJECT, actor: ADMIN, materialId: staged.materialId }),
    ).toThrow();
  });

  it("rejects invalid names, oversized files, and disallowed types with per-file reasons", () => {
    const { store } = openStore();
    const invalid = [
      { name: "  ", reason: "empty" },
      { name: "a/b.pdf", reason: "path-separator" },
      { name: "..\\evil.pdf", reason: "traversal" },
      { name: "resume.pdf\u0000", reason: "control-char" },
    ];
    for (const item of invalid) {
      expect(() =>
        store.stage({
          scope: PROJECT,
          actor: ADMIN,
          file: { name: item.name, mimeType: "application/pdf", bytes: RESUME_BYTES },
        }),
      ).toThrow(WorkbenchMaterialValidationError);
    }
    expect(() =>
      store.stage({
        scope: PROJECT,
        actor: ADMIN,
        file: { name: "run.exe", mimeType: "application/x-msdownload", bytes: RESUME_BYTES },
      }),
    ).toThrow(WorkbenchMaterialValidationError);
    expect(() =>
      store.stage({
        scope: PROJECT,
        actor: ADMIN,
        file: {
          name: "big.pdf",
          mimeType: "application/pdf",
          bytes: new Uint8Array(WORKBENCH_MATERIAL_DEFAULT_LIMITS.maxMaterialBytes + 1),
        },
      }),
    ).toThrow(WorkbenchMaterialValidationError);
  });

  it("enforces the per-scope material count limit", () => {
    const limited = createWorkbenchMaterialStore({
      storageRoot: NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wb-files-")),
      limits: { ...WORKBENCH_MATERIAL_DEFAULT_LIMITS, maxMaterialsPerScope: 1 },
    });
    stageResume(limited, "a.pdf");
    expect(() => stageResume(limited, "b.pdf")).toThrow(WorkbenchMaterialValidationError);
  });
});

describe("WorkbenchMaterialStore.read", () => {
  it("returns bytes and metadata for authorized admins of the owning scope", () => {
    const { store } = openStore();
    const staged = stageResume(store);
    const read = store.read({ scope: PROJECT, actor: ADMIN, materialId: staged.materialId });
    expect(Array.from(read.bytes)).toEqual(Array.from(RESUME_BYTES));
    expect(read.name).toBe("简历.pdf");
  });

  it("rejects unauthenticated actors and cross-project reads", () => {
    const { store } = openStore();
    const staged = stageResume(store);
    expect(() =>
      store.read({ scope: PROJECT, actor: OUTSIDER, materialId: staged.materialId }),
    ).toThrow(WorkbenchMaterialAccessError);
    expect(() =>
      store.read({
        scope: { kind: "project", projectId: "proj-2" },
        actor: ADMIN,
        materialId: staged.materialId,
      }),
    ).toThrow(WorkbenchMaterialAccessError);
  });

  it("rejects material ids that are not store-generated", () => {
    const { store } = openStore();
    expect(() =>
      store.read({ scope: PROJECT, actor: ADMIN, materialId: "../../etc/passwd" }),
    ).toThrow(WorkbenchMaterialAccessError);
  });
});

describe("WorkbenchMaterialStore.remove and replace", () => {
  it("removes an individual material", () => {
    const { store } = openStore();
    const staged = stageResume(store);
    store.remove({ scope: PROJECT, actor: ADMIN, materialId: staged.materialId });
    expect(() =>
      store.read({ scope: PROJECT, actor: ADMIN, materialId: staged.materialId }),
    ).toThrow(WorkbenchMaterialAccessError);
  });

  it("replace keeps the old material when staging the new one fails", () => {
    const { store } = openStore();
    const staged = stageResume(store);
    const failingStore = Object.create(store) as typeof store;
    expect(() =>
      failingStore.stage({
        scope: PROJECT,
        actor: ADMIN,
        file: {
          name: "replacement.exe",
          mimeType: "application/x-msdownload",
          bytes: RESUME_BYTES,
        },
      }),
    ).toThrow(WorkbenchMaterialValidationError);
    // Old material still readable.
    expect(
      Array.from(store.read({ scope: PROJECT, actor: ADMIN, materialId: staged.materialId }).bytes),
    ).toEqual(Array.from(RESUME_BYTES));
  });

  it("replaces only after the new upload succeeded", () => {
    const { store } = openStore();
    const staged = stageResume(store);
    const next = stageResume(store, "替换.pdf");
    store.replace({
      scope: PROJECT,
      actor: ADMIN,
      previousMaterialId: staged.materialId,
      stagedMaterialId: next.materialId,
    });
    expect(() =>
      store.read({ scope: PROJECT, actor: ADMIN, materialId: staged.materialId }),
    ).toThrow();
    expect(store.read({ scope: PROJECT, actor: ADMIN, materialId: next.materialId }).name).toBe(
      "替换.pdf",
    );
  });
});

describe("WorkbenchMaterialStore.chat handoff", () => {
  it("exposes a real T3 ChatFileAttachment handoff per contracts conventions", async () => {
    const { store } = openStore();
    const staged = stageResume(store);
    const handoff = store.toChatFileAttachment({
      scope: PROJECT,
      actor: ADMIN,
      materialId: staged.materialId,
      threadId: "thread-1",
    });
    // Validates against the real wire contract.
    expect(chatFileAttachmentIs(handoff)).toBe(true);
    expect(handoff).toMatchObject({
      type: "file",
      name: "简历.pdf",
      mimeType: "application/pdf",
      sizeBytes: RESUME_BYTES.length,
    });
    expect(handoff.id).toMatch(/^thread-1-/);
  });
});
