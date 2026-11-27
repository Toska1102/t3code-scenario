import { describe, expect, it } from "vite-plus/test";

import {
  createMaterialsDraftController,
  type MaterialsDraftItem,
} from "./materialsDraftController.ts";

function textFile(name: string, content = "hello") {
  return new File([content], name, { type: "text/plain" });
}

function pdfFile(name: string) {
  return new File(["%PDF-1.7"], name, { type: "application/pdf" });
}

function items(
  controller: ReturnType<typeof createMaterialsDraftController>,
): ReadonlyArray<MaterialsDraftItem> {
  return controller.getState().items;
}

describe("materialsDraftController", () => {
  it("adds valid files to the in-memory draft with per-item status", () => {
    const controller = createMaterialsDraftController();
    controller.addFiles([pdfFile("简历.pdf"), textFile("说明.txt")]);
    expect(items(controller)).toHaveLength(2);
    expect(items(controller)[0]?.status).toBe("ready");
    expect(controller.getState().draftRetained).toBe(true);
  });

  it("flags an invalid file per item and keeps the other inputs", () => {
    const controller = createMaterialsDraftController();
    controller.addFiles([pdfFile("简历.pdf"), textFile("bad.exe")]);
    const failed = items(controller).filter((item) => item.status === "error");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toContain("文件类型");
    expect(items(controller).filter((item) => item.status === "ready")).toHaveLength(1);
  });

  it("a failed upload keeps the in-memory draft, including the original File", async () => {
    const controller = createMaterialsDraftController();
    const file = pdfFile("简历.pdf");
    controller.addFiles([file]);
    await controller.upload(async () => {
      throw new Error("network down");
    });
    expect(items(controller)[0]?.status).toBe("error");
    expect(items(controller)[0]?.file).toBe(file);
    expect(controller.getState().draftRetained).toBe(true);
  });

  it("a successful upload marks the item uploaded and keeps others untouched", async () => {
    const controller = createMaterialsDraftController();
    controller.addFiles([pdfFile("a.pdf"), pdfFile("b.pdf")]);
    const first = items(controller)[0]!;
    await controller.upload(async (item) => ({ materialId: `wbmat-${item.name}` }));
    expect(items(controller)[0]?.status).toBe("uploaded");
    expect(items(controller)[0]?.materialId).toBe("wbmat-a.pdf");
    expect(items(controller)[1]?.status).toBe("uploaded");
    expect(items(controller).find((item) => item.localId === first.localId)?.file).toBeDefined();
  });

  it("removes an individual material from the draft", () => {
    const controller = createMaterialsDraftController();
    controller.addFiles([pdfFile("a.pdf")]);
    const localId = items(controller)[0]!.localId;
    controller.remove(localId);
    expect(items(controller)).toHaveLength(0);
  });

  it("replace stages a new upload and only drops the old material after success", async () => {
    const controller = createMaterialsDraftController();
    controller.addFiles([pdfFile("旧.pdf")]);
    await controller.upload(async (item) => ({ materialId: `wbmat-${item.name}` }));
    const localId = items(controller)[0]!.localId;
    controller.replace(localId, pdfFile("新.pdf"));

    // Old material still present while the replacement uploads.
    expect(items(controller)[0]?.name).toBe("旧.pdf");

    await controller.upload(async (item) => {
      if (item.name === "新.pdf") return { materialId: "wbmat-new" };
      throw new Error("upload failed");
    });
    expect(items(controller)).toHaveLength(1);
    expect(items(controller)[0]?.status).toBe("uploaded");
    expect(items(controller)[0]?.name).toBe("新.pdf");
  });

  it("replace failure keeps the old material and reports the error", () => {
    const controller = createMaterialsDraftController();
    controller.addFiles([pdfFile("旧.pdf")]);
    const localId = items(controller)[0]!.localId;
    controller.replace(localId, textFile("bad.exe"));
    expect(items(controller)[0]?.name).toBe("旧.pdf");
    expect(items(controller)[0]?.status).toBe("ready");
    // The invalid replacement is reported per item without discarding the draft.
    expect(controller.getState().lastError).toContain("文件类型");
  });
});
