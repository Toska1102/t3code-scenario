// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off globalDate:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { ChatAttachmentId, type ChatFileAttachment } from "@t3tools/contracts";

import {
  createDeterministicAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";

import {
  WORKBENCH_MATERIAL_DEFAULT_LIMITS,
  materialExtension,
  validateWorkbenchMaterialName,
  type WorkbenchMaterialLimits,
} from "@t3tools/shared/workbenchMaterialsShared";

export {
  WORKBENCH_MATERIAL_DEFAULT_LIMITS,
  materialExtension,
  validateWorkbenchMaterialName,
} from "@t3tools/shared/workbenchMaterialsShared";
export type { WorkbenchMaterialLimits } from "@t3tools/shared/workbenchMaterialsShared";

export type WorkbenchMaterialScope = { readonly kind: "project"; readonly projectId: string };

export type WorkbenchMaterialActor =
  | { readonly kind: "workbench-admin"; readonly userId: string }
  | { readonly kind: "unauthenticated" };

export type WorkbenchMaterial = {
  readonly materialId: string;
  readonly scope: WorkbenchMaterialScope;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly stagedAt: string;
};

export type WorkbenchMaterialRead = WorkbenchMaterial & {
  readonly bytes: Uint8Array;
  /** Absolute staged path, for handing the file to an agent run. */
  readonly absolutePath: string;
};

export class WorkbenchMaterialAccessError extends Error {}

/** Wraps shared validation failures so callers can distinguish user errors from access errors. */
export class WorkbenchMaterialValidationError extends Error {}

const MATERIAL_ID_PREFIX = "wbmat-";
const MATERIAL_ID_PATTERN = /^wbmat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type StageWorkbenchMaterialInput = {
  readonly scope: WorkbenchMaterialScope;
  readonly actor: WorkbenchMaterialActor;
  readonly file: { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array };
};

/** Wraps the shared validator to raise the typed server-side error. */
function requireValidMaterialName(rawName: string, limits: WorkbenchMaterialLimits): string {
  try {
    return validateWorkbenchMaterialName(rawName, limits);
  } catch (error) {
    throw new WorkbenchMaterialValidationError(
      error instanceof Error ? error.message : "文件名不合法。",
    );
  }
}

/**
 * Store for workbench materials (spec stories 17 and 28): real bytes, stable generated ids,
 * write-once staged artifacts, and reads scoped to the owning project. Disk names come from
 * the generated id and a whitelisted extension only — user input never enters a path.
 */
export function createWorkbenchMaterialStore(input: {
  readonly storageRoot: string;
  readonly limits?: Partial<WorkbenchMaterialLimits>;
  readonly idGenerator?: () => string;
  readonly now?: () => Date;
}) {
  const limits: WorkbenchMaterialLimits = { ...WORKBENCH_MATERIAL_DEFAULT_LIMITS, ...input.limits };
  const root = NodePath.resolve(input.storageRoot);
  const idGenerator =
    input.idGenerator ?? (() => `${MATERIAL_ID_PREFIX}${NodeCrypto.randomUUID()}`);
  const now = input.now ?? (() => new Date());
  const materials = new Map<string, WorkbenchMaterial>();

  function requireAdmin(actor: WorkbenchMaterialActor): void {
    // First workbench version: every authenticated user is an admin (spec §1 通用交互约定).
    if (actor.kind !== "workbench-admin") {
      throw new WorkbenchMaterialAccessError("未授权：需要工作台管理员身份。");
    }
  }

  function materialPath(material: WorkbenchMaterial): string {
    // `.bin` keeps the stored name independent of user input; the original name lives in the record.
    const { projectId } = material.scope;
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) ||
      !MATERIAL_ID_PATTERN.test(material.materialId)
    ) {
      throw new WorkbenchMaterialAccessError("非法的项目或材料标识。");
    }
    const directory = NodePath.join(root, "projects", projectId, "materials");
    const filePath = NodePath.resolve(directory, `${material.materialId}.bin`);
    if (!filePath.startsWith(`${directory}${NodePath.sep}`)) {
      throw new WorkbenchMaterialAccessError("非法的存储路径。");
    }
    return filePath;
  }

  function writeOnce(filePath: string, bytes: Uint8Array): void {
    NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${NodeCrypto.randomUUID()}.part`;
    const handle = NodeFS.openSync(tempPath, "wx");
    try {
      NodeFS.writeFileSync(handle, bytes);
    } finally {
      NodeFS.closeSync(handle);
    }
    try {
      // Hard-link into place: fails when the target already exists, so bytes are write-once.
      NodeFS.linkSync(tempPath, filePath);
    } catch {
      throw new WorkbenchMaterialAccessError("工件已存在，禁止覆盖。");
    } finally {
      NodeFS.rmSync(tempPath, { force: true });
    }
  }

  function scopeCount(projectId: string): number {
    let count = 0;
    for (const material of materials.values()) {
      if (material.scope.projectId === projectId) count += 1;
    }
    return count;
  }

  function lookupAuthorized(scope: WorkbenchMaterialScope, materialId: string): WorkbenchMaterial {
    if (!MATERIAL_ID_PATTERN.test(materialId)) {
      throw new WorkbenchMaterialAccessError("非法的材料标识。");
    }
    const material = materials.get(materialId);
    if (!material || material.scope.projectId !== scope.projectId) {
      throw new WorkbenchMaterialAccessError("材料不存在或不在当前范围内。");
    }
    return material;
  }

  return {
    limits,

    stage(
      input: StageWorkbenchMaterialInput,
    ): WorkbenchMaterial & { readonly absolutePath: string } {
      requireAdmin(input.actor);
      const name = requireValidMaterialName(input.file.name, limits);
      if (materialExtension(name, limits) === null) {
        throw new WorkbenchMaterialValidationError("不支持的文件类型。");
      }
      if (input.file.bytes.byteLength === 0) {
        throw new WorkbenchMaterialValidationError("文件内容不能为空。");
      }
      if (input.file.bytes.byteLength > limits.maxMaterialBytes) {
        throw new WorkbenchMaterialValidationError(
          `文件不能超过 ${Math.floor(limits.maxMaterialBytes / (1024 * 1024))} MiB。`,
        );
      }
      if (scopeCount(input.scope.projectId) >= limits.maxMaterialsPerScope) {
        throw new WorkbenchMaterialValidationError("材料数量已达上限。");
      }
      const material: WorkbenchMaterial = {
        materialId: idGenerator(),
        scope: input.scope,
        name,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.bytes.byteLength,
        digest: NodeCrypto.createHash("sha256").update(input.file.bytes).digest("hex"),
        stagedAt: now().toISOString(),
      };
      // Bytes land before the record registers: a failed write never leaves a phantom material.
      const absolutePath = materialPath(material);
      writeOnce(absolutePath, input.file.bytes);
      materials.set(material.materialId, material);
      return { ...material, absolutePath };
    },

    list(
      scope: WorkbenchMaterialScope,
      actor: WorkbenchMaterialActor,
    ): ReadonlyArray<WorkbenchMaterial> {
      requireAdmin(actor);
      return [...materials.values()].filter(
        (material) => material.scope.projectId === scope.projectId,
      );
    },

    read(input: {
      readonly scope: WorkbenchMaterialScope;
      readonly actor: WorkbenchMaterialActor;
      readonly materialId: string;
    }): WorkbenchMaterialRead {
      requireAdmin(input.actor);
      const material = lookupAuthorized(input.scope, input.materialId);
      const filePath = materialPath(material);
      let bytes: Buffer;
      try {
        bytes = NodeFS.readFileSync(filePath);
      } catch {
        throw new WorkbenchMaterialAccessError("读取材料失败。");
      }
      const digest = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
      if (digest !== material.digest) {
        throw new WorkbenchMaterialAccessError("工件内容与暂存摘要不一致。");
      }
      return { ...material, bytes: new Uint8Array(bytes), absolutePath: filePath };
    },

    remove(input: {
      readonly scope: WorkbenchMaterialScope;
      readonly actor: WorkbenchMaterialActor;
      readonly materialId: string;
    }): void {
      requireAdmin(input.actor);
      const material = lookupAuthorized(input.scope, input.materialId);
      NodeFS.rmSync(materialPath(material), { force: true });
      materials.delete(material.materialId);
    },

    /**
     * Swap a material for an already-staged one. The old material is only dropped after the
     * replacement exists, so a failed upload never loses the original (spec 02.01 添加附件).
     */
    replace(input: {
      readonly scope: WorkbenchMaterialScope;
      readonly actor: WorkbenchMaterialActor;
      readonly previousMaterialId: string;
      readonly stagedMaterialId: string;
    }): void {
      requireAdmin(input.actor);
      const previous = lookupAuthorized(input.scope, input.previousMaterialId);
      const staged = lookupAuthorized(input.scope, input.stagedMaterialId);
      NodeFS.rmSync(materialPath(previous), { force: true });
      materials.delete(previous.materialId);
      materials.set(staged.materialId, staged);
    },

    /** Real T3 attachment handoff: a wire-valid `ChatFileAttachment` for a T3 thread. */
    toChatFileAttachment(input: {
      readonly scope: WorkbenchMaterialScope;
      readonly actor: WorkbenchMaterialActor;
      readonly materialId: string;
      readonly threadId: string;
    }): ChatFileAttachment {
      const read = this.read(input);
      const threadSegment = toSafeThreadAttachmentSegment(input.threadId);
      if (!threadSegment) {
        throw new WorkbenchMaterialValidationError("非法的线程标识。");
      }
      const attachmentId = createDeterministicAttachmentId(
        input.threadId,
        `workbench-material:${read.materialId}:${read.digest}`,
      );
      if (!attachmentId) {
        throw new WorkbenchMaterialValidationError("无法生成附件标识。");
      }
      return {
        type: "file",
        id: ChatAttachmentId.make(attachmentId),
        name: read.name,
        mimeType: read.mimeType,
        sizeBytes: read.sizeBytes,
      };
    },
  };
}

export type WorkbenchMaterialStore = ReturnType<typeof createWorkbenchMaterialStore>;
