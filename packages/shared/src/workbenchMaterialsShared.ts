/**
 * Pure validation shared by the workbench file modules.
 * Spec defers file type and size limits ("待产品确认"); these conservative defaults are a
 * provisional implementation assumption: 25 MiB per file, 20 materials per project scope,
 * and a fixed extension whitelist.
 */
export const WORKBENCH_MATERIAL_DEFAULT_LIMITS = {
  maxMaterialBytes: 25 * 1024 * 1024,
  maxMaterialsPerScope: 20,
  maxNameChars: 255,
  allowedExtensions: [
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".docx",
    ".xlsx",
    ".pptx",
    ".zip",
  ],
} as const;

export type WorkbenchMaterialLimits = {
  readonly maxMaterialBytes: number;
  readonly maxMaterialsPerScope: number;
  readonly maxNameChars: number;
  readonly allowedExtensions: readonly string[];
};

export function materialExtension(name: string, limits: WorkbenchMaterialLimits): string | null {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  const hasDot = name.includes(".");
  return hasDot && limits.allowedExtensions.includes(extension) ? extension : null;
}

export function validateWorkbenchMaterialName(
  rawName: string,
  limits: WorkbenchMaterialLimits,
): string {
  const name = rawName.trim();
  if (name.length === 0) {
    throw new Error("文件名不能为空。");
  }
  if (name.length > limits.maxNameChars) {
    throw new Error(`文件名不能超过 ${limits.maxNameChars} 个字符。`);
  }
  // The name never reaches a path, but path-shaped and control characters are rejected explicitly.
  if (/[/\\\0]/.test(name) || name.includes("..") || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("文件名包含不允许的字符。");
  }
  return name;
}
